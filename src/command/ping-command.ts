import config from 'config';
import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import type { CommandInterface } from '../types.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { isIpPrivate } from '../lib/private-ip.js';
import { scopedLogger } from '../lib/logger.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import parse, { type PingParseOutput } from './handlers/ping/parse.js';

export type PingOptions = {
	type: 'ping';
	inProgressUpdates: boolean;
	target: string;
	packets: number;
	ipVersion: number;
};

const allowedIpVersions = [ 4, 6 ];

const pingOptionsSchema = Joi.object<PingOptions>({
	type: Joi.string().valid('ping'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string(),
	packets: Joi.number().min(1).max(16).default(3),
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
	constructor (private readonly cmd: typeof pingCmd) {}

	async run (socket: Socket, measurementId: string, testId: string, options: PingOptions): Promise<void> {
		const validationResult = pingOptionsSchema.validate(options);

		if (validationResult.error) {
			throw new InvalidOptionsException('ping', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBuffer(socket, testId, measurementId);
		let isResultPrivate = false;
		let result: PingParseOutput;

		const cmd = this.cmd(cmdOptions);

		if (cmdOptions.inProgressUpdates) {
			const pStdout: string[] = [];
			cmd.stdout?.on('data', (data: Buffer) => {
				pStdout.push(data.toString());
				const isValid = this.validatePartialResult(pStdout.join(''), cmd);

				if (!isValid) {
					isResultPrivate = !isValid;
					return;
				}

				buffer.pushProgress({ rawOutput: data.toString() });
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
					result.rawOutput += '\n\nMeasurement command timed out.';
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

		buffer.pushResult(this.toJsonOutput(result));
	}

	private validatePartialResult (rawOutput: string, cmd: ExecaChildProcess): boolean {
		const parseResult = parse(rawOutput);

		if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
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
