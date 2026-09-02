import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import type { CommandInterface, FailureSource } from '../types.js';
import { byLine } from '../lib/by-line.js';
import { ipEquals, joiValidateIp, normalizeIp } from '../lib/ip.js';
import { cachedDnsLookupOne, type IpFamily } from '../lib/dns.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { getFailureSource, isExposed } from '../lib/internal-error.js';
import { scopedLogger } from '../lib/logger.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import { createMeasurementDeadline, getMtrBudget, getProcessTimeout } from '../helper/timeout.js';
import { resolveCommandTarget, type CommandTargetLookup, type ResolvedCommandTarget } from '../helper/resolve-command-target.js';
import { validateCommandOptions } from '../helper/validate-command-options.js';

import type {
	ResultType,
	ResultTypeJson,
} from './handlers/mtr/types.js';
import MtrParser from './handlers/mtr/parser.js';
import { MtrHopEnrichment } from './handlers/mtr/enrichment.js';

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

const mtrOptionsSchema = Joi.object<MtrOptions>({
	type: Joi.string().valid('mtr'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string().custom(joiValidateIp).required(),
	protocol: Joi.string().lowercase().insensitive(),
	packets: Joi.number().integer().min(1).max(16).default(3),
	port: Joi.number().port(),
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
	const { interval, grace, nativeTimeout } = getMtrBudget(options.packets, options.timeout);
	const intervalArg = [ '--interval', String(interval) ];
	const protocolArg = options.protocol === 'icmp' ? [] : `--${options.protocol}`;
	const packetsArg = String(options.packets);

	const args = [
		'-n',
		// Ipv4 or IPv6
		`-${options.ipVersion}`,
		intervalArg,
		[ '--gracetime', String(grace) ],
		[ '--max-ttl', '30' ],
		[ '--timeout', String(nativeTimeout) ],
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

export class MtrCommand implements CommandInterface<MtrOptions> {
	constructor (private readonly cmd: typeof mtrCmd, private readonly lookup: CommandTargetLookup = cachedDnsLookupOne) {}

	async run (socket: Socket, measurementId: string, testId: string, options: MtrOptions): Promise<unknown> {
		const validationResult = validateCommandOptions(mtrOptionsSchema, options);

		if (validationResult.error) {
			throw new InvalidOptionsException('mtr', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'overwrite');
		const deadline = createMeasurementDeadline(cmdOptions.timeout);
		const { dnsHeadroom } = getMtrBudget(cmdOptions.packets, cmdOptions.timeout);
		let result: ResultType = getResultInitState();
		let cmd: ExecaChildProcess | undefined;
		let target: ResolvedCommandTarget | undefined;

		try {
			target = await resolveCommandTarget(cmdOptions.target, cmdOptions.ipVersion as IpFamily, deadline.signalFor(dnsHeadroom), this.lookup);
			const resolvedTarget = target;
			const enrichment = new MtrHopEnrichment(this.lookup, resolvedTarget, deadline.signal());
			const runningCommand = this.cmd({ ...cmdOptions, target: resolvedTarget.address }, deadline.processTimeout());
			cmd = runningCommand;

			if (runningCommand.stdout) {
				byLine(runningCommand.stdout, (data) => {
					if (data.startsWith('mtr:')) {
						runningCommand.kill('SIGKILL');
						return;
					}

					result.data.push(data);
					const rawAddress = /^h\s+\d+\s+(\S+)/.exec(data)?.[1];

					if (rawAddress) {
						enrichment.add(normalizeIp(rawAddress));
					}

					if (cmdOptions.inProgressUpdates) {
						buffer.pushLazyProgress(() => {
							const hops = MtrParser.rawParse(result.data.join(''), false, resolvedTarget.address);

							return { rawOutput: MtrParser.outputBuilder(enrichment.apply(hops)) };
						});
					}
				});
			}

			await runningCommand;
			let hops = MtrParser.rawParse(result.data.join(''), true, resolvedTarget.address);

			await enrichment.wait();
			hops = enrichment.apply(hops);
			const rawOutput = MtrParser.outputBuilder(hops);
			const firstHop = hops[0];

			if (firstHop?.resolvedAddress) {
				hops = [{ ...firstHop, resolvedHostname: '_gateway' }, ...hops.slice(1) ];
			}

			result = {
				status: 'finished',
				rawOutput,
				hops,
				data: result.data,
				resolvedAddress: resolvedTarget.address,
				resolvedHostname: resolvedTarget.hostname,
			};
		} catch (error: unknown) {
			result.status = 'failed';
			let failureSourceFallback: FailureSource = 'internal';

			if (isExecaError(error) && error.timedOut) {
				try {
					const hops = MtrParser.rawParse(error.stdout.toString(), true, target?.address);
					const lastHop = hops.at(-1);
					const targetResponded = lastHop?.resolvedAddress && target && ipEquals(lastHop.resolvedAddress, target.address) && lastHop.timings.length > 0;

					if (!targetResponded && hops.some(hop => hop.stats.drop > 0)) {
						failureSourceFallback = 'target';
					}
				} catch {}
			}

			result.failureSource = getFailureSource(error, failureSourceFallback);

			if (isExecaError(error)) {
				result.rawOutput = error.stdout.toString();

				if (error.timedOut) {
					result.rawOutput += `${result.rawOutput ? '\n\n' : ''}The measurement command timed out.`;
				} else {
					logger.error(error.shortMessage);
				}
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

	private toJsonOutput (input: ResultType): ResultTypeJson {
		return {
			status: input.status,
			...(input.status === 'failed' && { failureSource: input.failureSource }),
			rawOutput: input.rawOutput,
			resolvedAddress: input.resolvedAddress ? String(input.resolvedAddress) : null,
			resolvedHostname: input.resolvedHostname ? String(input.resolvedHostname) : null,
			hops: input.hops ? input.hops.map(h => ({
				asn: h.asn,
				resolvedAddress: h.resolvedAddress ? h.resolvedAddress : null,
				resolvedHostname: h.resolvedHostname ? h.resolvedHostname : null,
				stats: h.stats,
				timings: h.timings,
			})) : [],
		};
	}
}
