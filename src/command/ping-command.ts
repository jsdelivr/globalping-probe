import Joi from 'joi';
import isIpPrivate from 'private-ip';
import type {Socket} from 'socket.io-client';
import {execa, type ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {ProgressBuffer} from '../helper/progress-buffer.js';
import {scopedLogger} from '../lib/logger.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';
import parse, {type PingParseOutput} from './handlers/ping/parse.js';

export type PingOptions = {
	type: 'ping';
	inProgressUpdates: boolean;
	target: string;
	packets: number;
};

const pingOptionsSchema = Joi.object<PingOptions>({
	type: Joi.string().valid('ping'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string(),
	packets: Joi.number().min(1).max(16).default(3),
});

/* eslint-disable @typescript-eslint/ban-types */
export type PingParseOutputJson = {
	status: 'finished' | 'failed';
	rawOutput: string;
	resolvedHostname: string | null;
	resolvedAddress: string | null;
	timings: Array<{
		ttl: number;
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
/* eslint-enable @typescript-eslint/ban-types */

const logger = scopedLogger('ping-command');

export const argBuilder = (options: PingOptions): string[] => {
	const args = [
		'-4',
		['-c', options.packets.toString()],
		['-i', '0.2'],
		['-w', '15'],
		options.target,
	].flat();

	return args;
};

export const pingCmd = (options: PingOptions): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', ['ping', ...args]);
};

export class PingCommand implements CommandInterface<PingOptions> {
	constructor(private readonly cmd: typeof pingCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: PingOptions): Promise<void> {
		const {value: cmdOptions, error: validationError} = pingOptionsSchema.validate(options);

		if (validationError) {
			throw new InvalidOptionsException('ping', validationError);
		}

		const buffer = new ProgressBuffer(socket, testId, measurementId);
		const pStdout: string[] = [];
		let isResultPrivate = false;
		let result: PingParseOutput;

		const cmd = this.cmd(cmdOptions);

		if (cmdOptions.inProgressUpdates) {
			cmd.stdout?.on('data', (data: Buffer) => {
				pStdout.push(data.toString());
				const isValid = this.validatePartialResult(pStdout.join(''), cmd);

				if (!isValid) {
					isResultPrivate = !isValid;
					return;
				}

				buffer.pushProgress({rawOutput: data.toString()});
			});
		}

		try {
			const cmdResult = await cmd;

			if (cmdResult.stdout.length === 0) {
				logger.error('Successful stdout is empty', cmdResult);
			}

			const parseResult = parse(cmdResult.stdout);
			result = parseResult;

			if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
				isResultPrivate = true;
			}
		} catch (error: unknown) {
			if (isExecaError(error) && error.stdout.toString().length > 0) {
				result = parse(error.stdout.toString());
			} else {
				logger.error(error);
				result = {status: 'failed', rawOutput: 'Test failed. Please try again.'};
			}
		}

		if (isResultPrivate) {
			result = {
				status: 'failed',
				rawOutput: 'Private IP ranges are not allowed',
			};
		}

		buffer.pushResult(this.toJsonOutput(result));
	}

	private validatePartialResult(rawOutput: string, cmd: ExecaChildProcess): boolean {
		const parseResult = parse(rawOutput);

		if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private toJsonOutput(input: PingParseOutput): PingParseOutputJson {
		return {
			status: input.status,
			rawOutput: input.rawOutput,
			resolvedAddress: input.resolvedAddress ? input.resolvedAddress : null,
			resolvedHostname: input.resolvedHostname ? input.resolvedHostname : null,
			timings: input.timings ?? [],
			stats: {
				min: input.stats?.min ?? null,
				max: input.stats?.max ?? null,
				avg: input.stats?.avg ?? null,
				total: input.stats?.total ?? null,
				loss: input.stats?.loss ?? null,
				rcv: input.stats?.rcv ?? null,
				drop: input.stats?.drop ?? null,
			},
		};
	}
}
