import config from 'config';
import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import type { CommandInterface } from '../types.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { joiValidateIp, isIpPrivate } from '../lib/private-ip.js';
import { scopedLogger } from '../lib/logger.js';
import { byLine } from '../lib/by-line.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import parse, { type PingParseOutput } from './handlers/ping/parse.js';
import { tcpPing, formatTcpPingResult, TcpPingData } from './handlers/ping/tcp-ping.js';

export type PingOptions = {
	type: 'ping';
	inProgressUpdates: boolean;
	target: string;
	packets: number;
	protocol: string;
	port: number;
	ipVersion: 4 | 6;
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
});

export type PingParseOutputJson = {
	status: 'finished' | 'failed';
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

export const argBuilder = (options: PingOptions): string[] => {
	const args = [
		`-${options.ipVersion}`,
		'-O',
		[ '-c', options.packets.toString() ],
		[ '-i', '0.5' ],
		[ '-w', '10' ],
		options.target,
	].flat();

	return args;
};

export const pingCmd = (options: PingOptions): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', [ 'ping', ...args ], { timeout: config.get<number>('commands.timeout') * 1000 });
};

export class PingCommand implements CommandInterface<PingOptions> {
	async run (socket: Socket, measurementId: string, testId: string, options: PingOptions): Promise<unknown> {
		const validationResult = pingOptionsSchema.validate(options);

		if (validationResult.error) {
			throw new InvalidOptionsException('ping', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;

		return cmdOptions.protocol === 'TCP'
			? this.runTcp(tcpPing, socket, measurementId, testId, cmdOptions)
			: this.runIcmp(pingCmd, socket, measurementId, testId, cmdOptions);
	}

	async runIcmp (cmdFn: typeof pingCmd, socket: Socket, measurementId: string, testId: string, cmdOptions: PingOptions): Promise<unknown> {
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'append');
		let isResultPrivate = false;
		let result: PingParseOutput;

		const cmd = cmdFn(cmdOptions);

		if (cmd.stdout && cmdOptions.inProgressUpdates) {
			const pStdout: string[] = [];
			byLine(cmd.stdout, (data) => {
				pStdout.push(data);

				const parsed = parse(pStdout.join(''));
				const isValid = this.validatePartialResult(parsed, cmd);

				if (!isValid) {
					isResultPrivate = true;
					return;
				}

				buffer.pushProgress({ rawOutput: data });
			});
		}

		try {
			const cmdResult = await cmd;

			if (cmdResult.stdout.length === 0) {
				logger.error('Successful stdout is empty.', cmdResult);
			}

			const parseResult = parse(cmdResult.stdout);
			result = parseResult;

			if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
				isResultPrivate = true;
			}
		} catch (error: unknown) {
			result = { status: 'failed', rawOutput: 'Test failed. Please try again.' };

			if (isExecaError(error)) {
				result = parse(error.stdout.toString());

				if (error.timedOut) {
					result.status = 'failed';
					result.rawOutput += '\n\nThe measurement command timed out.';
				}

				!result.rawOutput && (result.rawOutput = 'Test failed. Please try again.');
			} else {
				logger.error(error);
			}
		}

		if (isResultPrivate) {
			result = {
				status: 'failed',
				rawOutput: 'Private IP ranges are not allowed.',
			};
		}

		const out = this.toJsonOutput(result);
		buffer.pushResult(out);
		return out;
	}

	async runTcp (cmdFn: typeof tcpPing, socket: Socket, measurementId: string, testId: string, cmdOptions: PingOptions): Promise<unknown> {
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'diff');
		const progress: Array<TcpPingData> = [];

		const progressHandler = cmdOptions.inProgressUpdates ? (progressResult: TcpPingData) => {
			progress.push(progressResult);

			buffer.pushProgress({
				rawOutput: formatTcpPingResult(progress).rawOutput,
			});
		} : undefined;

		const tcpPingResult = await cmdFn({ ...cmdOptions, timeout: 10_000, interval: 500 }, progressHandler);
		const result = formatTcpPingResult(tcpPingResult);

		const out = this.toJsonOutput(result);
		buffer.pushResult(out);
		return out;
	}

	private validatePartialResult (parsedOutput: PingParseOutput, cmd: ExecaChildProcess): boolean {
		if (isIpPrivate(parsedOutput.resolvedAddress ?? '')) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private toJsonOutput (input: PingParseOutput): PingParseOutputJson {
		return {
			status: input.status,
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
