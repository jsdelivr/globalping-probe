import dns from 'node:dns';
import isIpPrivate from 'private-ip';
import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

import type {HopType, ResultType} from './handlers/mtr/types.js';
import MtrParser from './handlers/mtr/parser.js';

type MtrOptions = {
	type: string;
	target: string;
	protocol: string;
	port: number;
	packets: number;
};

type DnsResolver = (addr: string, rrtype: string) => Promise<string[]>;

const mtrOptionsSchema = Joi.object<MtrOptions>({
	type: Joi.string().valid('mtr'),
	target: Joi.string(),
	protocol: Joi.string().lowercase().insensitive(),
	packets: Joi.number().min(1).max(16).default(3),
	port: Joi.number(),
});

export const getResultInitState = () => ({hops: [], rawOutput: ''});

export const mtrCmd = (options: MtrOptions): ExecaChildProcess => {
	const protocolArg = options.protocol === 'icmp' ? null : options.protocol;
	const packetsArg = String(options.packets);

	const args = [
		// Ipv4
		'-4',
		['-o', 'LDRAVM'],
		'--aslookup',
		'--show-ips',
		['--interval', '1'],
		['--gracetime', '3'],
		['--max-ttl', '20'],
		['--timeout', '15'],
		protocolArg ? `--${protocolArg}` : [],
		['-c', packetsArg],
		['--raw'],
		options.target,
	].flat();

	return execa('mtr', args);
};

export class MtrCommand implements CommandInterface<MtrOptions> {
	constructor(private readonly cmd: typeof mtrCmd, readonly dnsResolver: DnsResolver = dns.promises.resolve) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error} = mtrOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('mtr', error);
		}

		const cmd = this.cmd(cmdOptions);
		let isResultPrivate = false;
		const result: ResultType = {
			hops: [],
			rawOutput: '',
		};

		cmd.stdout?.on('data', async (data: Buffer) => {
			result.hops = await this.hopsParse(result.hops, data.toString());
			result.rawOutput = MtrParser.outputBuilder(result.hops);

			const isValid = this.validateResult(result.hops, cmd);

			if (!isValid) {
				isResultPrivate = !isValid;
				return;
			}

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				overwrite: true,
				result: {
					...result,
				},
			});
		});

		try {
			await cmd;
		} catch (error: unknown) {
			const output = isExecaError(error) ? error.stderr.toString() : '';

			result.rawOutput = output;
		}

		if (isResultPrivate) {
			result.hops = [];
			result.rawOutput = 'Private IP ranges are not allowed';
		}

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result,
		});
	}

	async hopsParse(hops: HopType[], data: string): Promise<HopType[]> {
		const nHops = MtrParser.hopsParse(hops, data.toString());
		const dnsResult = await Promise.allSettled(nHops.map(async h => h.host && !h.asn && !isIpPrivate(h.host) ? this.lookupAsn(h.host) : Promise.reject()));

		for (const [index, result] of dnsResult.entries()) {
			if (result.status === 'rejected' || !result.value) {
				continue;
			}

			const sDns = result.value.split('|');
			nHops[index]!.asn = sDns[0]!.trim();
		}

		return nHops;
	}

	async lookupAsn(addr: string): Promise<string | undefined> {
		const result = await this.dnsResolver(`${addr}.origin.asn.cymru.com`, 'TXT');

		return result.flat()[0];
	}

	private hasResultPrivateIp(hops: HopType[]): boolean {
		const privateResults = hops.filter((hop: HopType) => isIpPrivate(hop.host ?? ''));

		if (privateResults.length > 0) {
			return true;
		}

		return false;
	}

	private validateResult(hops: HopType[], cmd: ExecaChildProcess): boolean {
		const hasPrivateIp = this.hasResultPrivateIp(hops.slice(1)); // First hop is always gateway

		if (hasPrivateIp) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}
}
