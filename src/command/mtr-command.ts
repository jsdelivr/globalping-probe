import config from 'config';
import dns from 'node:dns';
import { isIP } from 'node:net';
import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import type { CommandInterface } from '../types.js';
import { isIpPrivate } from '../lib/private-ip.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { ProgressBufferOverwrite } from '../helper/progress-buffer-overwrite.js';
import { scopedLogger } from '../lib/logger.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';

import type {
	HopType,
	ResultType,
	ResultTypeJson,
} from './handlers/mtr/types.js';
import MtrParser, { NEW_LINE_REG_EXP } from './handlers/mtr/parser.js';

export type MtrOptions = {
	type: 'mtr';
	inProgressUpdates: boolean;
	target: string;
	protocol: string;
	port: number;
	packets: number;
	ipVersion: number;
};

type DnsResolver = (addr: string, rrtype?: string) => Promise<string[]>;

const logger = scopedLogger('mtr-command');
const allowedIpVersions = [ 4, 6 ];

const mtrOptionsSchema = Joi.object<MtrOptions>({
	type: Joi.string().valid('mtr'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string(),
	protocol: Joi.string().lowercase().insensitive(),
	packets: Joi.number().min(1).max(16).default(3),
	port: Joi.number(),
	ipVersion: Joi.when(Joi.ref('target'), {
		is: Joi.string().domain(),
		then: Joi.valid(...allowedIpVersions).default(4),
		otherwise: Joi.when(Joi.ref('target'), {
			is: Joi.string().ip({ version: [ 'ipv6' ], cidr: 'forbidden' }),
			then: Joi.valid(6).default(6),
			otherwise: Joi.valid(4).default(4),
		}),
	}),
});

export const getResultInitState = (): ResultType => ({ status: 'finished', hops: [], rawOutput: '', data: [] });

export const argBuilder = (options: MtrOptions): string[] => {
	const intervalArg = [ '--interval', String(config.get<number>('commands.mtr.interval')) ];
	const protocolArg = options.protocol === 'icmp' ? [] : `--${options.protocol}`;
	const packetsArg = String(options.packets);

	const args = [
		// Ipv4 or IPv6
		`-${options.ipVersion}`,
		intervalArg,
		[ '--gracetime', '3' ],
		[ '--max-ttl', '30' ],
		[ '--timeout', '15' ],
		protocolArg,
		[ '-c', packetsArg ],
		[ '--raw' ],
		[ '-P', `${options.port}` ],
		options.target,
	].flat();

	return args;
};

export const mtrCmd = (options: MtrOptions): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', [ 'mtr', ...args ]);
};

export class MtrCommand implements CommandInterface<MtrOptions> {
	constructor (private readonly cmd: typeof mtrCmd, readonly dnsResolver: DnsResolver = dns.promises.resolve) {}

	async run (socket: Socket, measurementId: string, testId: string, options: MtrOptions): Promise<void> {
		const validationResult = mtrOptionsSchema.validate(options);

		if (validationResult.error) {
			throw new InvalidOptionsException('mtr', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBufferOverwrite(socket, testId, measurementId);
		const cmd = this.cmd(cmdOptions);
		let result: ResultType = getResultInitState();

		// TODO: remove:
		// eslint-disable-next-line @typescript-eslint/no-misused-promises
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

			const output = await this.parseResult(result.data, false);
			result.hops = output.hops;
			result.rawOutput = output.rawOutput;

			if (cmdOptions.inProgressUpdates) {
				buffer.pushProgress({
					rawOutput: result.rawOutput,
				});
			}
		});

		try {
			await this.checkForPrivateDest(cmdOptions.target);
			await cmd;
			result = await this.parseResult(result.data, true);
		} catch (error: unknown) {
			result.status = 'failed';
			result.rawOutput = 'Test failed. Please try again.';

			if (isExecaError(error) && error.stdout.toString().length > 0) {
				result.rawOutput = error.stdout.toString();
			} else {
				cmd.kill('SIGKILL');

				if (error instanceof Error) {
					result.hops = [];
					result.data = [];
				}

				if (error instanceof Error && error.message === 'private destination') {
					result.rawOutput = 'Private IP ranges are not allowed';
				} else {
					logger.error(error);
				}
			}
		}

		buffer.pushResult(this.toJsonOutput(result));
	}

	async parseResult (data: string[], isFinalResult = false): Promise<ResultType> {
		let nHops = MtrParser.rawParse(data.join('\n'), isFinalResult);
		const asnList = await this.queryAsn(nHops);
		nHops = this.populateAsn(nHops, asnList);
		const rawOutput = MtrParser.outputBuilder(nHops);

		const lastHop = [ ...nHops ].reverse().find(h => h.resolvedAddress);

		return {
			status: 'finished',
			rawOutput,
			hops: nHops,
			data,
			resolvedAddress: String(lastHop?.resolvedAddress),
			resolvedHostname: String(lastHop?.resolvedHostname),
		};
	}

	populateAsn (hops: HopType[], asnList: string[][]): HopType[] {
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

	async queryAsn (hops: HopType[]): Promise<string[][]> {
		const dnsResult = await Promise.allSettled(hops.map(h => (
			h?.asn.length < 1 && h?.resolvedAddress && !isIpPrivate(h?.resolvedAddress)
				? this.lookupAsn(h?.resolvedAddress)
				: Promise.reject(new Error('didn\'t lookup ASN'))
		)));

		const asnList = [];

		for (const [ index, result ] of dnsResult.entries()) {
			const resolvedAddress = hops[index]?.resolvedAddress;

			if (!resolvedAddress || result.status === 'rejected' || !result.value) {
				continue;
			}

			const sDns = result.value.split('|');
			asnList.push([ resolvedAddress, sDns[0]!.trim() ?? '' ]);
		}

		return asnList;
	}

	async lookupAsn (addr: string): Promise<string | undefined> {
		const reversedAddr = addr.split('.').reverse().join('.');
		const result = await this.dnsResolver(`${reversedAddr}.origin.asn.cymru.com`, 'TXT');

		return result.flat()[0];
	}

	private toJsonOutput (input: ResultType): ResultTypeJson {
		return {
			status: input.status,
			rawOutput: input.rawOutput,
			resolvedAddress: input.resolvedAddress ? input.resolvedAddress : null,
			resolvedHostname: input.resolvedHostname ? input.resolvedHostname : null,
			hops: input.hops ? input.hops.map(h => ({
				...h,
				resolvedAddress: h.resolvedAddress ? h.resolvedAddress : null,
				resolvedHostname: h.resolvedHostname ? h.resolvedHostname : null,
			})) : [],
		};
	}

	private async checkForPrivateDest (target: string): Promise<void> {
		if (isIP(target) !== 0) {
			if (isIpPrivate(target)) {
				throw new Error('private destination');
			}

			return;
		}

		const [ ipAddress ] = await this.dnsResolver(target).catch(() => []);

		if (isIpPrivate(String(ipAddress))) {
			throw new Error('private destination');
		}
	}
}
