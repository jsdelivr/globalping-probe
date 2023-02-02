import dns from 'node:dns';
import {isIP} from 'is-ip';
import isIpPrivate from 'private-ip';
import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {getConfValue} from '../lib/config.js';
import {ProgressBufferOverwrite} from '../helper/progress-buffer-overwrite.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

import type {
	HopType,
	ResultType,
	ResultTypeJson,
} from './handlers/mtr/types.js';
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

export const getResultInitState = (): ResultType => ({status: 'finished', hops: [], rawOutput: '', data: []});

export const argBuilder = (options: MtrOptions): string[] => {
	const intervalArg = ['--interval', String(getConfValue('commands.mtr.interval'))];
	const protocolArg = options.protocol === 'icmp' ? [] : `--${options.protocol}`;
	const packetsArg = String(options.packets);

	const args = [
		// Ipv4
		'-4',
		intervalArg,
		['--gracetime', '3'],
		['--max-ttl', '30'],
		['--timeout', '15'],
		protocolArg,
		['-c', packetsArg],
		['--raw'],
		['-P', `${options.port}`],
		options.target,
	].flat();

	return args;
};

export const mtrCmd = (options: MtrOptions): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', ['mtr', ...args]);
};

export class MtrCommand implements CommandInterface<MtrOptions> {
	constructor(private readonly cmd: typeof mtrCmd, readonly dnsResolver: DnsResolver = dns.promises.resolve) {}

	async run(socket: Socket, measurementId: string, testId: string, options: MtrOptions): Promise<void> {
		const {value: cmdOptions, error: validationError} = mtrOptionsSchema.validate(options);
		const buffer = new ProgressBufferOverwrite(socket, testId, measurementId);

		if (validationError) {
			throw new InvalidOptionsException('mtr', validationError);
		}

		const cmd = this.cmd(cmdOptions);
		let result: ResultType = getResultInitState();

		cmd.stdout?.on('data', async (data: Buffer) => {
			if (data.toString().startsWith('mtr:')) {
				cmd.stderr?.emit('error', data);
				return;
			}

			for (const line of data.toString().split(NEW_LINE_REG_EXP)) {
				if (!line) {
					continue;
				}

				result.data.push(line);
			}

			const output = await this.parseResult(result.hops, result.data, false);
			result.hops = output.hops;
			result.rawOutput = output.rawOutput;

			buffer.pushProgress({
				hops: result.hops,
				rawOutput: result.rawOutput,
			});
		});

		try {
			await this.checkForPrivateDest(options.target);
			await cmd;
			result = await this.parseResult(result.hops, result.data, true);
		} catch (error: unknown) {
			result.status = 'failed';
			if (isExecaError(error)) {
				result.rawOutput = error.stdout.toString();
			} else {
				cmd.kill('SIGKILL');

				if (error instanceof Error) {
					result.hops = [];
					result.data = [];

					if (error.message === 'private destination') {
						result.rawOutput = 'Private IP ranges are not allowed';
					}
				}
			}
		}

		buffer.pushResult(this.toJsonOutput(result));
	}

	async parseResult(hops: HopType[], data: string[], isFinalResult = false): Promise<ResultType> {
		let nHops = this.parseData(hops, data.join('\n'), isFinalResult);
		const asnList = await this.queryAsn(nHops);
		nHops = this.populateAsn(nHops, asnList);
		const rawOutput = MtrParser.outputBuilder(nHops);

		const lastHop = [...nHops].reverse().find(h => h.resolvedAddress && !h.duplicate);

		return {
			status: 'finished',
			rawOutput,
			hops: nHops,
			data,
			resolvedAddress: String(lastHop?.resolvedAddress),
			resolvedHostname: String(lastHop?.resolvedHostname),
		};
	}

	parseData(hops: HopType[], data: string, isFinalResult?: boolean): HopType[] {
		return MtrParser.rawParse(hops, data.toString(), isFinalResult);
	}

	populateAsn(hops: HopType[], asnList: string[][]): HopType[] {
		return hops.map((hop: HopType) => {
			const asn = asnList.find((a: string[]) => hop.resolvedAddress ? a.includes(hop.resolvedAddress) : false);

			if (!asn) {
				return hop;
			}

			const asnArray = String(asn?.[1]).split(' ').map(Number);

			return {
				...hop,
				asn: asnArray,
			};
		});
	}

	async queryAsn(hops: HopType[]): Promise<string[][]> {
		const dnsResult = await Promise.allSettled(hops.map(async h => (
			h?.asn.length < 1 && h?.resolvedAddress && !isIpPrivate(h?.resolvedAddress)
				? this.lookupAsn(h?.resolvedAddress)
				: Promise.reject(new Error('didn\'t lookup ASN'))
		)));

		const asnList = [];

		for (const [index, result] of dnsResult.entries()) {
			const resolvedAddress = hops[index]?.resolvedAddress;

			if (!resolvedAddress || result.status === 'rejected' || !result.value) {
				continue;
			}

			const sDns = result.value.split('|');
			asnList.push([resolvedAddress, sDns[0]!.trim() ?? '']);
		}

		return asnList;
	}

	async lookupAsn(addr: string): Promise<string | undefined> {
		const reversedAddr = addr.split('.').reverse().join('.');
		const result = await this.dnsResolver(`${reversedAddr}.origin.asn.cymru.com`, 'TXT');

		return result.flat()[0];
	}

	private toJsonOutput(input: ResultType): ResultTypeJson {
		return {
			status: input.status,
			rawOutput: input.rawOutput,
			resolvedAddress: input.resolvedAddress ? input.resolvedAddress : null,
			resolvedHostname: input.resolvedHostname ? input.resolvedHostname : null,
			hops: input.hops ? input.hops.map(h => ({
				...h,
				duplicate: Boolean(h.duplicate),
				resolvedAddress: h.resolvedAddress ? h.resolvedAddress : null,
				resolvedHostname: h.resolvedHostname ? h.resolvedHostname : null,
			})) : [],
		};
	}

	private async checkForPrivateDest(target: string): Promise<void> {
		if (isIP(target)) {
			if (isIpPrivate(target)) {
				throw new Error('private destination');
			}

			return;
		}

		const [ipAddress] = await this.dnsResolver(target).catch(() => []);

		if (isIpPrivate(String(ipAddress))) {
			throw new Error('private destination');
		}
	}
}
