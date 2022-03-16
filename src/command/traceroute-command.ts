import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import isIpPrivate from 'private-ip';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

const reHeaderLine = new RegExp(/^traceroute to\s.*\s\((?<addr>.*)\)/);
const reResultLine = new RegExp(/(?<id>\d+)\s+(?<host>(\S+)\s+\((?:((?:\d+\.){3}\d+)|([\da-fA-F:]))\))\s+(?<rtt>\d*(?:\.\d+)?)\s+ms\s+(?<rtt2>\d*(?:\.\d+)?)/);

type TraceOptions = {
	type: string;
	target: string;
	protocol: string;
	port: number;
};

type ParsedLine = {
	host: string;
	host2: string | undefined;
	rtt: number;
	rtt2: number;
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
				result: {rawOutput: data.toString()},
			});
		});

		const result = await cmd;

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result: this.parse(result.stdout),
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

		// Imagine banning reduce. wtf
		// eslint-disable-next-line unicorn/no-array-reduce
		const hops = lines.slice(1).reduce((acc: ParsedLine[], l: string): ParsedLine[] => {
			const parsed: ParsedLine | undefined = this.parseLine(l);

			if (parsed && !isIpPrivate(parsed.host2!)) {
				return [...acc, parsed];
			}

			return acc;
		}, []);

		return {
			destination: header.addr,
			hops,
			rawOutput,
		};
	}

	private parseHeader(line: string) {
		const output = reHeaderLine.exec(line);

		if (!output) {
			return;
		}

		return {
			addr: output?.groups?.['addr'],
		};
	}

	private parseLine(line: string): ParsedLine | undefined {
		const output = reResultLine.exec(line);

		if (!output) {
			return;
		}

		return {
			host: output?.groups?.['host'] ?? '',
			host2: output?.[4],
			rtt: Number.parseFloat(output?.groups?.['rtt'] ?? ''),
			rtt2: Number.parseFloat(output?.groups?.['rtt2'] ?? ''),
		};
	}
}
