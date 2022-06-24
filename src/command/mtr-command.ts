import dns from 'node:dns';
import {isIP} from 'is-ip';
import isIpPrivate from 'private-ip';
import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

import type {HopType, ResultType} from './handlers/mtr/types.js';
import MtrParser, {NEW_LINE_REG_EXP} from './handlers/mtr/parser.js';

export type MtrOptions = {
	type: string;
	target: string;
	protocol: string;
	port: number;
	packets: number;
};

type DnsResolver = (addr: string, rrtype?: string) => Promise<string[]>;

const mtrOptionsSchema = Joi.object<MtrOptions>({
	type: Joi.string().valid('mtr'),
	target: Joi.string(),
	protocol: Joi.string().lowercase().insensitive(),
	packets: Joi.number().min(1).max(16).default(3),
	port: Joi.number(),
});

export const getResultInitState = () => ({hops: [], rawOutput: '', data: []});

export const mtrCmd = (options: MtrOptions): ExecaChildProcess => {
	const protocolArg = options.protocol === 'icmp' ? null : options.protocol;
	const packetsArg = String(options.packets);

	const args = [
		// Ipv4
		'-4',
		['-o', 'LDRAVM'],
		'--aslookup',
		'--show-ips',
		['--interval', '0.5'],
		['--gracetime', '3'],
		['--max-ttl', '20'],
		['--timeout', '15'],
		protocolArg ? `--${protocolArg}` : [],
		['-c', packetsArg],
		['--raw'],
		options.target,
	].flat();

	const cmd = ['mtr', ...args].join(' ');

	return execa('script', ['-q', '-c', cmd, '/dev/null']);
};

export class MtrCommand implements CommandInterface<MtrOptions> {
	constructor(private readonly cmd: typeof mtrCmd, readonly dnsResolver: DnsResolver = dns.promises.resolve) {}

	async run(socket: Socket, measurementId: string, testId: string, options: MtrOptions): Promise<void> {
		const {value: cmdOptions, error} = mtrOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('mtr', error);
		}

		let isResultPrivate = false;
		const cmd = this.cmd(cmdOptions);
		const result: ResultType = getResultInitState();

		cmd.stdout?.on('data', async (data: Buffer) => {
			if (isResultPrivate) {
				return;
			}

			for (const line of data.toString().split(NEW_LINE_REG_EXP)) {
				if (!line) {
					continue;
				}

				result.data.push(line);
			}

			const [hops, rawOutput] = await this.parseResult(result.hops, result.data, false);
			result.hops = hops;
			result.rawOutput = rawOutput;

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				overwrite: true,
				result: {
					hops: result.hops,
					rawOutput: result.rawOutput,
				},
			});
		});

		try {
			await this.checkForPrivateDest(options.target);

			await cmd;
			const [hops, rawOutput] = await this.parseResult(result.hops, result.data, true);
			result.hops = hops;
			result.rawOutput = rawOutput;
		} catch (error: unknown) {
			if (error instanceof Error && error.message === 'private destination') {
				isResultPrivate = true;
			}

			const output = isExecaError(error) ? error.stderr.toString() : '';
			result.rawOutput = output;
		}

		if (isResultPrivate) {
			result.hops = [];
			result.data = [];
			result.rawOutput = 'Private IP ranges are not allowed';
		}

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result: {
				hops: result.hops,
				rawOutput: result.rawOutput,
				data: result.data,
			},
		});
	}

	async parseResult(hops: HopType[], data: string[], isFinalResult = false): Promise<[HopType[], string]> {
		let nHops = this.parseData(hops, data.join('\n'), isFinalResult);
		const asnList = await this.queryAsn(nHops);
		nHops = this.populateAsn(nHops, asnList);
		const rawOutput = MtrParser.outputBuilder(nHops);

		return [nHops, rawOutput];
	}

	parseData(hops: HopType[], data: string, isFinalResult?: boolean): HopType[] {
		return MtrParser.rawParse(hops, data.toString(), isFinalResult);
	}

	populateAsn(hops: HopType[], asnList: string[][]): HopType[] {
		return hops.map((hop: HopType) => {
			const asn = asnList.find((a: string[]) => hop.host ? a.includes(hop.host) : false);

			if (!asn) {
				return hop;
			}

			return {
				...hop,
				asn: String(asn?.[1]),
			};
		});
	}

	async queryAsn(hops: HopType[]): Promise<string[][]> {
		const dnsResult = await Promise.allSettled(hops.map(async h => (
			!h?.asn && h?.host && !isIpPrivate(h?.host)
				? this.lookupAsn(h?.host)
				: Promise.reject()
		)));

		const asnList = [];

		for (const [index, result] of dnsResult.entries()) {
			const host = hops[index]?.host;

			if (!host || result.status === 'rejected' || !result.value) {
				continue;
			}

			const sDns = result.value.split('|');
			asnList.push([host, sDns[0]!.trim() ?? '']);
		}

		return asnList;
	}

	async lookupAsn(addr: string): Promise<string | undefined> {
		const reversedAddr = addr.split('.').reverse().join('.');
		const result = await this.dnsResolver(`${reversedAddr}.origin.asn.cymru.com`, 'TXT');

		return result.flat()[0];
	}

	private async checkForPrivateDest(target: string): Promise<void> {
		if (isIP(target)) {
			if (isIpPrivate(target)) {
				throw new Error('private destination');
			}

			return;
		}

		const [ipAddress] = await this.dnsResolver(target);

		if (isIpPrivate(String(ipAddress))) {
			throw new Error('private destination');
		}
	}
}
