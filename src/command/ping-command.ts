import Joi from 'joi';
import isIpPrivate from 'private-ip';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {ProgressBuffer} from '../helper/progress-buffer.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

export type PingOptions = {
	type: 'ping';
	target: string;
	packets: number;
};

const pingOptionsSchema = Joi.object<PingOptions>({
	type: Joi.string().valid('ping'),
	target: Joi.string(),
	packets: Joi.number().min(1).max(16).default(3),
});

type PingStats = {
	min?: number;
	max?: number;
	avg?: number;
	loss?: number;
};

type PingTimings = {
	ttl: number;
	rtt: number;
};

type PingParseOutput = {
	rawOutput: string;
	resolvedHostname?: string;
	resolvedAddress?: string;
	timings?: PingTimings[];
	stats?: PingStats;
};

/* eslint-disable @typescript-eslint/ban-types */
export type PingParseOutputJson = {
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
		loss: number | null;
	};
};
/* eslint-enable @typescript-eslint/ban-types */

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

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error: validationError} = pingOptionsSchema.validate(options);
		const buffer = new ProgressBuffer(socket, testId, measurementId);

		if (validationError) {
			throw new InvalidOptionsException('ping', validationError);
		}

		const pStdout: string[] = [];
		let isResultPrivate = false;

		const cmd = this.cmd(cmdOptions);
		cmd.stdout?.on('data', (data: Buffer) => {
			pStdout.push(data.toString());
			const isValid = this.validatePartialResult(pStdout.join(''), cmd);

			if (!isValid) {
				isResultPrivate = !isValid;
				return;
			}

			buffer.pushProgress({rawOutput: data.toString()});
		});

		let result = {
			rawOutput: '',
		};

		try {
			const cmdResult = await cmd;
			const parseResult = this.parse(cmdResult.stdout);
			result = parseResult;

			if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
				isResultPrivate = true;
			}
		} catch (error: unknown) {
			const output = isExecaError(error) ? error.stdout.toString() : '';
			result = {
				rawOutput: output,
			};
		}

		if (isResultPrivate) {
			result = {
				rawOutput: 'Private IP ranges are not allowed',
			};
		}

		buffer.pushResult(this.toJsonOutput(result));
	}

	private validatePartialResult(rawOutput: string, cmd: ExecaChildProcess): boolean {
		const parseResult = this.parse(rawOutput);

		if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private toJsonOutput(input: PingParseOutput): PingParseOutputJson {
		return {
			rawOutput: input.rawOutput,
			resolvedAddress: input.resolvedAddress ? input.resolvedAddress : null,
			resolvedHostname: input.resolvedHostname ? input.resolvedHostname : null,
			timings: input.timings ?? [],
			stats: {
				min: input.stats?.min ?? null,
				max: input.stats?.max ?? null,
				avg: input.stats?.avg ?? null,
				loss: input.stats?.loss ?? null,
			},
		};
	}

	private parse(rawOutput: string): PingParseOutput {
		const lines = rawOutput.split('\n');

		if (lines.length === 0) {
			return {rawOutput};
		}

		const header = /^PING\s(?<host>.*?)\s\((?<addr>.+?)\)/.exec(lines[0] ?? '');
		if (!header) {
			return {rawOutput};
		}

		const resolvedAddress = String(header?.groups?.['addr']);
		const timeLines = lines.slice(1).map(l => this.parseStatsLine(l)).filter(Boolean) as PingTimings[];

		const resolvedHostname = (/(?<=from\s).*?(?=\s)/.exec((lines[1] ?? '')))?.[0];
		const summaryHeaderIndex = lines.findIndex(l => /^---\s(.*)\sstatistics ---/.test(l));
		const summary = this.parseSummary(lines.slice(summaryHeaderIndex + 1));

		return {
			resolvedAddress,
			resolvedHostname: resolvedHostname ?? '',
			timings: timeLines,
			stats: summary,
			rawOutput,
		};
	}

	private parseStatsLine(line: string): PingTimings | undefined {
		const parsed = /^\d+ bytes from (?<host>.*) .*: (?:icmp_)?seq=\d+ ttl=(?<ttl>\d+) time=(?<time>\d*(?:\.\d+)?) ms/.exec(line);

		if (!parsed || !parsed.groups) {
			return;
		}

		return {
			ttl: Number.parseInt(parsed.groups['ttl'] ?? '-1', 10),
			rtt: Number.parseFloat(parsed.groups['time'] ?? '-1'),
		};
	}

	private parseSummary(lines: string[]): PingStats {
		const [packets, rtt] = lines;
		const stats: Record<string, any> = {};

		if (rtt) {
			const rttMatch = /^(?:round-trip|rtt)\s.*\s=\s(?<min>\d*(?:\.\d+)?)\/(?<avg>\d*(?:\.\d+)?)\/(?<max>\d*(?:\.\d+)?)?/.exec(rtt);

			stats['min'] = Number.parseFloat(rttMatch?.groups?.['min'] ?? '');
			stats['avg'] = Number.parseFloat(rttMatch?.groups?.['avg'] ?? '');
			stats['max'] = Number.parseFloat(rttMatch?.groups?.['max'] ?? '');
		}

		if (packets) {
			const packetsMatch = /(?<loss>\d*(?:\.\d+)?)%\spacket\sloss/.exec(packets);
			stats['loss'] = Number.parseFloat(packetsMatch?.groups?.['loss'] ?? '-1');
		}

		return stats;
	}
}
