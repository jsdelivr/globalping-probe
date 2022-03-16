import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

const reHost = /(\S+)\s+\((?:((?:\d+\.){3}\d+)|([\da-fA-F:]))\)/;
const reRtt = /(\d+(?:\.?\d+)?)\s+ms(!\S*)?/g;

type TraceOptions = {
	type: string;
	target: string;
	protocol: string;
	port: number;
};

type ParsedLine = {
	resolvedAddress: string;
	host: string;
	rtt: number[];
};

const traceOptionsSchema = Joi.object<TraceOptions>({
	type: Joi.string().valid('traceroute'),
	target: Joi.string(),
	protocol: Joi.string(),
	port: Joi.number(),
});

export const traceCmd = (options: TraceOptions): ExecaChildProcess => {
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
		options.protocol === 'TCP' ? ['-p', `${options.port}`] : [],
		// Target
		options.target,
	].flat();

	return execa('traceroute', args);
};

export class TracerouteCommand implements CommandInterface<TraceOptions> {
	constructor(private readonly cmd: typeof traceCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error} = traceOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('traceroute', error);
		}

		const cmd = this.cmd(cmdOptions);
		cmd.stdout?.on('data', (data: Buffer) => {
			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {rawOutput: data.toString().trim()},
			});
		});

		const result = await cmd;

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result: this.parse(result.stdout.trim()),
		});
	}

	private parse(rawOutput: string) {
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

		return {
			destination: header.resolvedAddress,
			hops,
			rawOutput,
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

	private parseLine(line: string): ParsedLine | undefined {
		const hostMatch = reHost.exec(line);
		const rttList = Array.from(line.matchAll(reRtt), m => Number.parseFloat(m[1]!));

		return {
			host: hostMatch?.[1] ?? '*',
			resolvedAddress: hostMatch?.[2] ?? '*',
			rtt: rttList,
		};
	}
}
