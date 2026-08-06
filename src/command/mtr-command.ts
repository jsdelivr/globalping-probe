import config from 'config';
import { isIP } from 'node:net';
import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import type { CommandInterface, FailureSource } from '../types.js';
import { byLine } from '../lib/by-line.js';
import { joiValidateIp, isIpPrivate } from '../lib/ip.js';
import { cachedDnsLookup, type IpFamily } from '../lib/dns.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { getFailureSource, InternalError, isExposed } from '../lib/internal-error.js';
import { scopedLogger } from '../lib/logger.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import { getProcessTimeout } from '../helper/timeout.js';
import { validateCommandOptions } from '../helper/validate-command-options.js';

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
	timeout: number;
};

const logger = scopedLogger('mtr-command');
const allowedIpVersions = [ 4, 6 ];
const mtrConfig = config.get<{ interval: number; minInterval: number }>('commands.mtr');

const mtrOptionsSchema = Joi.object<MtrOptions>({
	type: Joi.string().valid('mtr'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string().custom(joiValidateIp).required(),
	protocol: Joi.string().lowercase().insensitive(),
	packets: Joi.number().min(1).max(16).default(3),
	port: Joi.number(),
	ipVersion: Joi.when(Joi.ref('target'), {
		is: Joi.string().ip({ version: [ 'ipv4' ], cidr: 'forbidden' }).required(),
		then: Joi.valid(4).default(4),
		otherwise: Joi.when(Joi.ref('target'), {
			is: Joi.string().ip({ version: [ 'ipv6' ], cidr: 'forbidden' }).required(),
			then: Joi.valid(6).default(6),
			otherwise: Joi.valid(...allowedIpVersions).default(4),
		}),
	}),
	timeout: Joi.number().integer(),
});

export const getResultInitState = (): ResultType => ({ status: 'finished', hops: [], rawOutput: '', data: [] });

export const argBuilder = (options: MtrOptions): string[] => {
	const interval = options.packets * mtrConfig.interval > options.timeout - 1 ? mtrConfig.minInterval : mtrConfig.interval;
	const remaining = Math.floor(options.timeout - options.packets * interval);
	const grace = Math.min(3, remaining);
	const intervalArg = [ '--interval', String(interval) ];
	const protocolArg = options.protocol === 'icmp' ? [] : `--${options.protocol}`;
	const packetsArg = String(options.packets);

	const args = [
		// Ipv4 or IPv6
		`-${options.ipVersion}`,
		intervalArg,
		[ '--gracetime', String(grace) ],
		[ '--max-ttl', '30' ],
		[ '--timeout', String(remaining) ],
		protocolArg,
		[ '-c', packetsArg ],
		[ '--raw' ],
		[ '-P', `${options.port}` ],
		options.target,
	].flat();

	return args;
};

export const mtrCmd = (options: MtrOptions, processTimeout = getProcessTimeout(options.timeout)): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', [ 'mtr', ...args ], { timeout: processTimeout });
};

const deadlineTimeoutError = (failureSource: FailureSource = 'target') => new InternalError('The measurement command timed out.', true, failureSource);

export class MtrCommand implements CommandInterface<MtrOptions> {
	constructor (private readonly cmd: typeof mtrCmd, private readonly lookup = cachedDnsLookup) {}

	async run (socket: Socket, measurementId: string, testId: string, options: MtrOptions): Promise<unknown> {
		const validationResult = validateCommandOptions(mtrOptionsSchema, options);

		if (validationResult.error) {
			throw new InvalidOptionsException('mtr', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'overwrite');
		const deadline = Date.now() + cmdOptions.timeout * 1000;
		const deadlineSignal = AbortSignal.timeout(Math.max(deadline - Date.now(), 0));
		let result: ResultType = getResultInitState();
		let cmd: ExecaChildProcess | undefined;

		try {
			const minimumRuntime = Math.round((cmdOptions.packets * mtrConfig.minInterval + 1) * 1000);
			const lookupTimeout = deadline - minimumRuntime - Date.now();

			if (lookupTimeout <= 0) {
				throw deadlineTimeoutError();
			}

			const lookupSignal = AbortSignal.timeout(lookupTimeout);
			let target: string;

			try {
				target = await this.resolveTarget(cmdOptions, lookupSignal);
			} catch (error: unknown) {
				if (lookupSignal.aborted) {
					throw deadlineTimeoutError('resolver');
				}

				throw error;
			}

			const remaining = deadline - Date.now();

			if (remaining <= 0) {
				throw deadlineTimeoutError();
			}

			cmd = this.cmd({ ...cmdOptions, target, timeout: remaining / 1000 }, getProcessTimeout(remaining / 1000));

			if (cmd.stdout) {
				byLine(cmd.stdout, (data) => {
					if (data.startsWith('mtr:')) {
						cmd!.kill('SIGKILL');
						return;
					}

					for (const line of data.split(NEW_LINE_REG_EXP)) {
						if (!line) {
							continue;
						}

						result.data.push(line);
					}

					if (cmdOptions.inProgressUpdates) {
						buffer.pushLazyProgress(async () => ({
							rawOutput: (await this.parseResult(result.data, false, deadlineSignal, target)).rawOutput,
						}));
					}
				});
			}

			await cmd;
			result = await this.parseResult(result.data, true, deadlineSignal, target);
			result.resolvedAddress = target;
		} catch (error: unknown) {
			result.status = 'failed';
			result.failureSource = getFailureSource(error, isExecaError(error) && error.timedOut ? 'target' : 'internal');

			if (isExecaError(error)) {
				result.rawOutput = error.stdout.toString();
				error.timedOut && (result.rawOutput += `${result.rawOutput ? '\n\n' : ''}The measurement command timed out.`);
			} else {
				cmd?.kill('SIGKILL');

				if (error instanceof Error) {
					result.hops = [];
					result.data = [];

					if (isExposed(error)) {
						result.rawOutput = error.message;
					} else {
						logger.error(error);
					}
				}
			}

			!result.rawOutput && (result.rawOutput = 'Test failed. Please try again.');
		}

		const out = this.toJsonOutput(result);
		buffer.pushResult(out);
		return out;
	}

	async parseResult (data: string[], isFinalResult = false, signal?: AbortSignal, target?: string): Promise<ResultType> {
		let nHops = MtrParser.rawParse(data.join('\n'), isFinalResult, target);
		const asnList = await this.queryAsn(nHops, signal);

		nHops = this.populateAsn(nHops, asnList);
		const rawOutput = MtrParser.outputBuilder(nHops);

		const lastHop = nHops.at(-1);

		return {
			status: 'finished',
			rawOutput,
			hops: nHops,
			data,
			resolvedHostname: lastHop?.resolvedHostname ?? null,
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

	async queryAsn (hops: HopType[], signal?: AbortSignal): Promise<string[][]> {
		const dnsResult = await Promise.allSettled(hops.map(h => (
			h?.asn.length < 1 && h?.resolvedAddress && !isIpPrivate(h?.resolvedAddress)
				? this.lookupAsn(h?.resolvedAddress, signal)
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

	async lookupAsn (addr: string, signal?: AbortSignal): Promise<string | undefined> {
		const reversedAddr = addr.split('.').reverse().join('.');
		const result = await this.lookup(`${reversedAddr}.origin.asn.cymru.com`, {
			rrtype: 'TXT',
			...(signal ? { signal } : {}),
		});

		return result[0];
	}

	private toJsonOutput (input: ResultType): ResultTypeJson {
		return {
			status: input.status,
			...(input.status === 'failed' && { failureSource: input.failureSource }),
			rawOutput: input.rawOutput,
			resolvedAddress: input.resolvedAddress ? String(input.resolvedAddress) : null,
			resolvedHostname: input.resolvedHostname ? String(input.resolvedHostname) : null,
			hops: input.hops ? input.hops.map(h => ({
				...h,
				resolvedAddress: h.resolvedAddress ? h.resolvedAddress : null,
				resolvedHostname: h.resolvedHostname ? h.resolvedHostname : null,
			})) : [],
		};
	}

	private async resolveTarget (options: MtrOptions, signal?: AbortSignal): Promise<string> {
		if (isIP(options.target) !== 0) {
			if (isIpPrivate(options.target)) {
				throw new InternalError('Private IP ranges are not allowed.', true, 'target');
			}

			return options.target;
		}

		const [ address ] = await this.lookup(options.target, {
			family: options.ipVersion as IpFamily,
			...(signal ? { signal } : {}),
		});

		return address;
	}
}
