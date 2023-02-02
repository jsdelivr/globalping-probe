import Joi from 'joi';
import isIpPrivate from 'private-ip';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {ProgressBuffer} from '../helper/progress-buffer.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

const reHost = /(\S+)\s+\((?:((?:\d+\.){3}\d+)|([\da-fA-F:]))\)/;
const reRtt = /(\d+(?:\.?\d+)?)\s+ms(!\S*)?/g;

export type TraceOptions = {
	type: string;
	target: string;
	protocol: string;
	port: number;
};

type ParsedLine = {
	resolvedAddress?: string;
	resolvedHostname?: string;
	timings: Array<{rtt: number}>;
};

type ParsedOutput = {
	rawOutput: string;
	resolvedAddress?: string;
	resolvedHostname?: string;
	hops?: ParsedLine[];
};

/* eslint-disable @typescript-eslint/ban-types */
type ParsedOutputJson = {
	rawOutput: string;
	status: 'finished' | 'failed';
	resolvedAddress: string | null;
	resolvedHostname: string | null;
	hops: Array<{
		resolvedAddress: string | null;
		resolvedHostname: string | null;
		timings: Array<{rtt: number}>;
	}>;
};
/* eslint-enable @typescript-eslint/ban-types */

const traceOptionsSchema = Joi.object<TraceOptions>({
	type: Joi.string().valid('traceroute'),
	target: Joi.string(),
	protocol: Joi.string(),
	port: Joi.number(),
});

export const argBuilder = (options: TraceOptions): string[] => {
	const port = options.protocol === 'TCP' ? ['-p', `${options.port}`] : [];

	const args = [
		// Ipv4
		'-4',
		// Max ttl
		['-m', '20'],
		// Max timeout
		['-w', '2'],
		// Probe packets per hop
		['-q', '2'],
		// Concurrent packets
		['-N', '20'],
		// Protocol
		`--${options.protocol.toLowerCase()}`,
		// Port
		port,
		// Target
		options.target,
	].flat();

	return args;
};

export const traceCmd = (options: TraceOptions): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', ['traceroute', ...args]);
};

export class TracerouteCommand implements CommandInterface<TraceOptions> {
	constructor(private readonly cmd: typeof traceCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error: validationError} = traceOptionsSchema.validate(options);
		const buffer = new ProgressBuffer(socket, testId, measurementId);

		if (validationError) {
			throw new InvalidOptionsException('traceroute', validationError);
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

		let result = {};
		try {
			const cmdResult = await cmd;
			const parseResult = this.parse(cmdResult.stdout.trim());
			result = this.toJsonOutput(parseResult);

			if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
				isResultPrivate = true;
			}
		} catch (error: unknown) {
			const output = isExecaError(error) ? error.stdout.toString() : '';
			result = {
				status: 'failed',
				rawOutput: output,
			};
		}

		if (isResultPrivate) {
			result = {
				status: 'failed',
				rawOutput: 'Private IP ranges are not allowed',
			};
		}

		buffer.pushResult(result);
	}

	private validatePartialResult(rawOutput: string, cmd: ExecaChildProcess): boolean {
		const parseResult = this.parse(rawOutput);

		if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private parse(rawOutput: string): ParsedOutput {
		const lines = rawOutput.split('\n');

		if (lines.length === 0) {
			return {
				rawOutput,
			};
		}

		const header = this.parseHeader(lines[0]!);

		if (!header) {
			return {
				rawOutput,
			};
		}

		const hops = lines.slice(1).map(l => this.parseLine(l));
		const hostname = hops[hops.length - 1]?.resolvedHostname;

		return {
			resolvedAddress: String(header.resolvedAddress),
			resolvedHostname: String(hostname),
			hops,
			rawOutput,
		};
	}

	private toJsonOutput(input: ParsedOutput): ParsedOutputJson {
		return {
			rawOutput: input.rawOutput,
			status: 'finished',
			resolvedAddress: input.resolvedAddress === '*' || !input.resolvedAddress ? null : input.resolvedAddress,
			resolvedHostname: input.resolvedHostname === '*' || !input.resolvedHostname ? null : input.resolvedHostname,
			hops: input.hops ? input.hops.map((h: ParsedLine) => ({
				...h,
				resolvedAddress: h.resolvedAddress === '*' || !h.resolvedAddress ? null : h.resolvedAddress,
				resolvedHostname: h.resolvedHostname === '*' || !h.resolvedHostname ? null : h.resolvedHostname,
			})) : [],
		};
	}

	private parseHeader(line: string) {
		const hostMatch = reHost.exec(line);

		if (!hostMatch || hostMatch.length < 3) {
			return;
		}

		return {
			host: hostMatch[0] ?? '',
			resolvedAddress: hostMatch[2],
		};
	}

	private parseLine(line: string): ParsedLine {
		const hostMatch = reHost.exec(line);
		const rttList = Array.from(line.matchAll(reRtt), m => Number.parseFloat(m[1]!));

		return {
			resolvedHostname: hostMatch?.[1] ?? '*',
			resolvedAddress: hostMatch?.[2] ?? '*',
			timings: rttList.map(rtt => ({rtt})),
		};
	}
}
