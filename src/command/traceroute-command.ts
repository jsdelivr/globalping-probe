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

const reHost = /(\S+?)(%\w+)?(\s+)\(((?:\d+\.){3}\d+|[\da-fA-F:]+)(%\w+)?\)/;
const reRtt = /(\d+(?:\.?\d+)?)\s+ms(!\S*)?/g;

export type TraceOptions = {
	type: 'traceroute';
	inProgressUpdates: boolean;
	target: string;
	protocol: string;
	port: number;
	ipVersion: number;
};

type ParsedLine = {
	resolvedAddress?: string;
	resolvedHostname?: string;
	timings: Array<{ rtt: number }>;
};

type ParsedOutput = {
	rawOutput: string;
	resolvedAddress?: string;
	resolvedHostname?: string;
	hops?: ParsedLine[];
};

type ParsedOutputJson = {
	rawOutput: string;
	status: 'finished' | 'failed';
	resolvedAddress: string | null;
	resolvedHostname: string | null;
	hops: Array<{
		resolvedAddress: string | null;
		resolvedHostname: string | null;
		timings: Array<{ rtt: number }>;
	}>;
};

const logger = scopedLogger('traceroute-command');

const allowedIpVersions = [ 4, 6 ];

const traceOptionsSchema = Joi.object<TraceOptions>({
	type: Joi.string().valid('traceroute'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string().custom(joiValidateIp).required(),
	protocol: Joi.string(),
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
});

export const argBuilder = (options: TraceOptions): string[] => {
	const port = options.protocol === 'TCP' ? [ '-p', `${options.port}` ] : [];

	const args = [
		// Ipv4 or IPv6
		`-${options.ipVersion}`,
		// Max ttl
		[ '-m', '20' ],
		// MAX timeout; note that this also disables the HERE and NEAR limits
		[ '-w', '2' ],
		// Probe packets per hop
		[ '-q', '2' ],
		// Concurrent packets
		[ '-N', '20' ],
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
	return execa('unbuffer', [ 'traceroute', ...args ], { timeout: config.get<number>('commands.timeout') * 1000 });
};

export class TracerouteCommand implements CommandInterface<TraceOptions> {
	constructor (private readonly cmd: typeof traceCmd) {}

	async run (socket: Socket, measurementId: string, testId: string, options: TraceOptions): Promise<unknown> {
		const validationResult = traceOptionsSchema.validate(options);

		if (validationResult.error) {
			throw new InvalidOptionsException('traceroute', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'diff');
		let isResultPrivate = false;
		let result = {};

		const cmd = this.cmd(cmdOptions);

		if (cmd.stdout && cmdOptions.inProgressUpdates) {
			const pStdout: string[] = [];
			byLine(cmd.stdout, (data) => {
				pStdout.push(data);

				const parsed = this.parse(pStdout.join(''));
				const isValid = this.validatePartialResult(parsed, cmd);

				if (!isValid) {
					isResultPrivate = true;
					return;
				}

				buffer.pushProgress({ rawOutput: parsed.rawOutput });
			});
		}

		try {
			const cmdResult = await cmd;

			if (cmdResult.stdout.length === 0) {
				logger.error('Successful stdout is empty.', cmdResult);
			}

			const parseResult = this.parse(cmdResult.stdout.trim());
			result = this.toJsonOutput(parseResult);

			if (isIpPrivate(parseResult.resolvedAddress ?? '')) {
				isResultPrivate = true;
			}
		} catch (error: unknown) {
			let output = '';

			if (isExecaError(error)) {
				output = error.stdout.toString();
				error.timedOut && (output += '\n\nThe measurement command timed out.');
			} else {
				logger.error(error);
			}

			result = {
				status: 'failed',
				rawOutput: output || 'Test failed. Please try again.',
			};
		}

		if (isResultPrivate) {
			result = {
				status: 'failed',
				rawOutput: 'Private IP ranges are not allowed.',
			};
		}

		buffer.pushResult(result);
		return result;
	}

	private validatePartialResult (parsedOutput: ParsedOutput, cmd: ExecaChildProcess): boolean {
		if (isIpPrivate(parsedOutput.resolvedAddress ?? '')) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private parse (rawOutput: string): ParsedOutput {
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

		// Hide the gateway hostname.
		if (lines[1]) {
			lines[1] = lines[1].replace(reHost, '_gateway$3($4$5)');
		}

		const hops = lines.slice(1).map(l => this.parseLine(l));
		const hostname = hops[hops.length - 1]?.resolvedHostname;

		return {
			resolvedAddress: String(header.resolvedAddress),
			resolvedHostname: String(hostname),
			hops,
			rawOutput: lines.join('\n'),
		};
	}

	private toJsonOutput (input: ParsedOutput): ParsedOutputJson {
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

	private parseHeader (line: string) {
		const hostMatch = reHost.exec(line);

		if (!hostMatch || hostMatch.length < 5) {
			return;
		}

		return {
			host: hostMatch[0] ?? '',
			resolvedAddress: hostMatch[4],
		};
	}

	private parseLine (line: string): ParsedLine {
		const hostMatch = reHost.exec(line);
		const rttList = Array.from(line.matchAll(reRtt), m => Number.parseFloat(m[1]!));

		return {
			resolvedHostname: hostMatch?.[1] ?? '*',
			resolvedAddress: hostMatch?.[4] ?? '*',
			timings: rttList.map(rtt => ({ rtt })),
		};
	}
}
