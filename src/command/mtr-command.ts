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

const mtrOptionsSchema = Joi.object<MtrOptions>({
	type: Joi.string().valid('mtr'),
	target: Joi.string(),
	protocol: Joi.string().lowercase().insensitive(),
	packets: Joi.number().min(1).max(16).default(3),
	port: Joi.number(),
});

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
	constructor(private readonly cmd: typeof mtrCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error} = mtrOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('mtr', error);
		}

		const cmd = this.cmd(cmdOptions);
		const result: ResultType = {
			hops: [],
			rawOutput: '',
		};

		cmd.stdout?.on('data', async (data: Buffer) => {
			result.hops = await this.hopsParse(result.hops, data.toString());
			result.rawOutput = MtrParser.outputBuilder(result.hops);

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
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

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result,
		});
	}

	async lookupAsn(addr: string): Promise<string | undefined> {
		const result = await dns.promises.resolve(`${addr}.origin.asn.cymru.com`, 'TXT');

		return result.flat()[0];
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
}
