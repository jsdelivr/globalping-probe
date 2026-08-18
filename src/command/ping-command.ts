import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import type { CommandInterface, FailureSource, TestStatus } from '../types.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { joiValidateIp } from '../lib/ip.js';
import { scopedLogger } from '../lib/logger.js';
import { byLine } from '../lib/by-line.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import parse, { type PingParseOutput } from './handlers/ping/parse.js';
import { tcpPing, formatTcpPingResult, TcpPingData } from './handlers/ping/tcp-ping.js';
import { createMeasurementDeadline, getPingBudget, getProcessTimeout } from '../helper/timeout.js';
import { validateCommandOptions } from '../helper/validate-command-options.js';
import { resolveCommandTarget, type CommandTargetLookup } from '../helper/resolve-command-target.js';
import { getFailureSource, isExposed } from '../lib/internal-error.js';
import { cachedDnsLookup } from '../lib/dns.js';

export type PingOptions = {
	type: 'ping';
	inProgressUpdates: boolean;
	target: string;
	packets: number;
	protocol: string;
	port: number;
	ipVersion: 4 | 6;
	timeout: number;
};

export type PingCommandOptions = {
	interval?: number;
	processTimeout?: number;
};

const allowedIpVersions = [ 4, 6 ];

const pingOptionsSchema = Joi.object<PingOptions>({
	type: Joi.string().valid('ping'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string().custom(joiValidateIp).required(),
	packets: Joi.number().min(1).max(16).default(3),
	protocol: Joi.string().default('ICMP'),
	port: Joi.number().default(80),
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

export type PingParseOutputJson = {
	status: TestStatus;
	failureSource?: FailureSource;
	rawOutput: string;
	resolvedHostname: string | null;
	resolvedAddress: string | null;
	timings: Array<{
		ttl?: number;
		rtt: number;
	}>;
	stats: {
		min: number | null;
		max: number | null;
		avg: number | null;
		total: number | null;
		loss: number | null;
		rcv: number | null;
		drop: number | null;
	};
};

const logger = scopedLogger('ping-command');

const classifyIcmpFailure = (
	error: unknown,
	rawOutput: string,
	targetResponded: boolean,
): FailureSource => {
	if (isExecaError(error) && error.timedOut) {
		if (targetResponded) {
			return 'internal';
		}

		return /(?:^|\n)no answer yet for |100% packet loss/m.test(rawOutput) ? 'target' : 'internal';
	}

	return 'internal';
};

export const normalizePingOutput = (output: string, address: string, hostname: string): string => {
	if (hostname === address) {
		return output;
	}

	return output.split('\n').map((line) => {
		if (line.startsWith(`PING ${address} (${address})`)) {
			return line.replace(`PING ${address} (${address})`, `PING ${hostname} (${address})`);
		}

		if (line.includes(` bytes from ${address}:`)) {
			return line.replace(` bytes from ${address}:`, ` bytes from ${hostname} (${address}):`);
		}

		if (line.startsWith(`From ${address} `)) {
			return line.replace(`From ${address} `, `From ${hostname} (${address}) `);
		}

		if (line === `--- ${address} ping statistics ---`) {
			return `--- ${hostname} ping statistics ---`;
		}

		return line;
	}).join('\n');
};

export const argBuilder = (options: PingOptions, commandOptions: PingCommandOptions = {}): string[] => {
	const { interval: packetInterval, responseTimeout } = getPingBudget(options.packets, options.timeout, commandOptions.interval);

	const args = [
		`-${options.ipVersion}`,
		'-O',
		'-n',
		[ '-c', options.packets.toString() ],
		[ '-i', String(packetInterval) ],
		[ '-W', String(responseTimeout) ],
		options.target,
	].flat();

	return args;
};

export const pingCmd = (options: PingOptions, commandOptions: PingCommandOptions = {}): ExecaChildProcess => {
	const args = argBuilder(options, commandOptions);
	return execa('unbuffer', [ 'ping', ...args ], { timeout: commandOptions.processTimeout ?? getProcessTimeout(options.timeout) });
};

export class PingCommand implements CommandInterface<PingOptions> {
	constructor (private readonly cmd = pingCmd, private readonly lookup: CommandTargetLookup = cachedDnsLookup) {}

	async run (socket: Socket, measurementId: string, testId: string, options: PingOptions): Promise<unknown> {
		const validationResult = validateCommandOptions(pingOptionsSchema, options);

		if (validationResult.error) {
			throw new InvalidOptionsException('ping', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const deadline = createMeasurementDeadline(cmdOptions.timeout);
		const { dnsHeadroom } = getPingBudget(cmdOptions.packets, cmdOptions.timeout);
		const lookupSignal = deadline.signalFor(dnsHeadroom);

		let target;

		try {
			target = await resolveCommandTarget(cmdOptions.target, cmdOptions.ipVersion, lookupSignal, this.lookup);
		} catch (error: unknown) {
			let rawOutput = 'Test failed. Please try again.';

			if (error instanceof Error && isExposed(error)) {
				rawOutput = error.message;
			} else {
				logger.error(error);
			}

			const result: PingParseOutput = {
				status: 'failed',
				failureSource: getFailureSource(error, 'internal'),
				rawOutput,
			};

			const out = this.toJsonOutput(result);
			new ProgressBuffer(socket, testId, measurementId, 'append').pushResult(out);
			return out;
		}

		const resolvedOptions = { ...cmdOptions, target: target.address };
		const remaining = deadline.remainingMs();

		if (cmdOptions.protocol === 'TCP') {
			return this.runTcp(tcpPing, socket, measurementId, testId, resolvedOptions, target.hostname, remaining);
		}

		return this.runIcmp((commandOptions: PingOptions) => this.cmd(commandOptions, { processTimeout: deadline.processTimeout() }), socket, measurementId, testId, resolvedOptions, target.hostname);
	}

	async runIcmp (cmdFn: typeof pingCmd, socket: Socket, measurementId: string, testId: string, cmdOptions: PingOptions, resolvedHostname = cmdOptions.target): Promise<unknown> {
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'append');
		const cmd = cmdFn(cmdOptions);
		let result: PingParseOutput;

		if (cmd.stdout && cmdOptions.inProgressUpdates) {
			byLine(cmd.stdout, (data) => {
				buffer.pushProgress({ rawOutput: normalizePingOutput(data, cmdOptions.target, resolvedHostname) });
			});
		}

		const toResult = (stdout: string): PingParseOutput => ({
			...parse(normalizePingOutput(stdout, cmdOptions.target, resolvedHostname)),
			resolvedAddress: cmdOptions.target,
			resolvedHostname,
		});

		try {
			const cmdResult = await cmd;

			if (cmdResult.stdout.length === 0) {
				logger.error('Successful stdout is empty.', cmdResult);
			}

			result = toResult(cmdResult.stdout);

			if (result.status === 'failed') {
				result.failureSource = 'internal';
			}
		} catch (error: unknown) {
			result = { status: 'failed', failureSource: 'internal', rawOutput: 'Test failed. Please try again.' };

			if (isExecaError(error)) {
				result = toResult(error.stdout.toString());

				result.failureSource = classifyIcmpFailure(
					error,
					result.rawOutput,
					Boolean(result.timings?.length),
				);

				if (error.timedOut) {
					result.status = 'failed';
					result.rawOutput += `${result.rawOutput ? '\n\n' : ''}The measurement command timed out.`;
				}

				!result.rawOutput && (result.rawOutput = 'Test failed. Please try again.');
			} else {
				logger.error(error);
			}
		}

		const out = this.toJsonOutput(result);
		buffer.pushResult(out);
		return out;
	}

	async runTcp (cmdFn: typeof tcpPing, socket: Socket, measurementId: string, testId: string, cmdOptions: PingOptions, hostname = cmdOptions.target, timeout = cmdOptions.timeout * 1000): Promise<unknown> {
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'diff');
		const progress: Array<TcpPingData> = [];

		const progressHandler = cmdOptions.inProgressUpdates ? (progressResult: TcpPingData) => {
			progress.push(progressResult);

			buffer.pushProgress({
				rawOutput: formatTcpPingResult(progress).rawOutput,
			});
		} : undefined;

		const { interval } = getPingBudget(cmdOptions.packets, cmdOptions.timeout);
		const tcpPingResult = await cmdFn({ address: cmdOptions.target, hostname, port: cmdOptions.port, packets: cmdOptions.packets, timeout, interval: interval * 1000, ipVersion: cmdOptions.ipVersion }, progressHandler);
		const result = formatTcpPingResult(tcpPingResult);

		const out = this.toJsonOutput(result);
		buffer.pushResult(out);
		return out;
	}

	private toJsonOutput (input: PingParseOutput): PingParseOutputJson {
		return {
			status: input.status,
			...(input.status === 'failed' && { failureSource: input.failureSource }),
			rawOutput: input.rawOutput,
			resolvedAddress: input.resolvedAddress ? input.resolvedAddress : null,
			resolvedHostname: input.resolvedHostname ? input.resolvedHostname : null,
			timings: input.timings ?? [],
			stats: {
				min: (input.stats?.min || input.stats?.min === 0) ? input.stats?.min : null,
				max: (input.stats?.max || input.stats?.max === 0) ? input.stats?.max : null,
				avg: (input.stats?.avg || input.stats?.avg === 0) ? input.stats?.avg : null,
				total: (input.stats?.total || input.stats?.total === 0) ? input.stats?.total : null,
				loss: (input.stats?.loss || input.stats?.loss === 0) ? input.stats?.loss : null,
				rcv: (input.stats?.rcv || input.stats?.rcv === 0) ? input.stats?.rcv : null,
				drop: (input.stats?.drop || input.stats?.drop === 0) ? input.stats?.drop : null,
			},
		};
	}
}
