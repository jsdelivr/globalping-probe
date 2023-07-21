import Joi from 'joi';
import isIpPrivate from 'private-ip';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import tldjs from 'tldjs';
import type { CommandInterface } from '../types.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { InternalError } from '../lib/internal-error.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { scopedLogger } from '../lib/logger.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';

import ClassicDigParser from './handlers/dig/classic.js';
import type {
	DnsParseResponse as DnsParseResponseClassic,
	DnsParseResponseJson as DnsParseResponseClassicJson,
} from './handlers/dig/classic.js';
import TraceDigParser from './handlers/dig/trace.js';
import type {
	DnsParseResponse as DnsParseResponseTrace,
	DnsParseResponseJson as DnsParseResponseTraceJson,
} from './handlers/dig/trace.js';
import { isDnsSection } from './handlers/dig/shared.js';
import type { DnsParseLoopResponse } from './handlers/dig/shared.js';

export type DnsOptions = {
	type: 'dns';
	inProgressUpdates: boolean;
	target: string;
	protocol: string;
	port: number;
	resolver?: string;
	trace: boolean;
	query: {
		type: string;
	};
};

const logger = scopedLogger('dns-command');

const isTrace = (output: unknown): output is DnsParseResponseTrace => Array.isArray((output as DnsParseResponseTrace).hops);

const allowedTypes = [ 'A', 'AAAA', 'ANY', 'CNAME', 'DNSKEY', 'DS', 'MX', 'NS', 'NSEC', 'PTR', 'RRSIG', 'SOA', 'TXT', 'SRV' ];
const allowedProtocols = [ 'UDP', 'TCP' ];

const dnsOptionsSchema = Joi.object<DnsOptions>({
	type: Joi.string().valid('dns'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string(),
	resolver: Joi.string().optional(),
	protocol: Joi.string().valid(...allowedProtocols).optional().default('udp'),
	port: Joi.number().optional().default('53'),
	trace: Joi.boolean().optional().default(false),
	query: Joi.object({
		type: Joi.string().valid(...allowedTypes).optional().default('A'),
	}),
});

export const argBuilder = (options: DnsOptions): string[] => {
	const protocolArg = options.protocol.toLowerCase() === 'tcp' ? '+tcp' : [];
	const resolverArg = options.resolver ? `@${options.resolver}` : [];
	const traceArg = options.trace ? '+trace' : [];
	const queryArg = options.query.type === 'PTR' ? '-x' : [ '-t', options.query.type ];

	const args = [
		queryArg,
		options.target,
		resolverArg,
		[ '-p', String(options.port) ],
		'-4',
		'+timeout=3',
		'+tries=2',
		'+nocookie',
		'+nsid',
		traceArg,
		protocolArg,
	].flat();

	return args;
};

export const dnsCmd = (options: DnsOptions): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', [ 'dig', ...args ]);
};

export class DnsCommand implements CommandInterface<DnsOptions> {
	constructor (private readonly cmd: typeof dnsCmd) {}

	async run (socket: Socket, measurementId: string, testId: string, options: DnsOptions): Promise<void> {
		const { value: cmdOptions, error: validationError } = dnsOptionsSchema.validate(options);

		if (validationError) {
			throw new InvalidOptionsException('dns', validationError);
		}

		const buffer = new ProgressBuffer(socket, testId, measurementId);
		let isResultPrivate = false;
		let result: Partial<DnsParseResponseClassic | DnsParseResponseTrace> = {};

		const cmd = this.cmd(cmdOptions);

		if (cmdOptions.inProgressUpdates) {
			const pStdout: string[] = [];
			cmd.stdout?.on('data', (data: Buffer) => {
				pStdout.push(data.toString());

				let output = '';

				try {
					output = this.rewrite(pStdout.join(''), options.trace);
					const parsedResult = this.parse(output, options.trace);
					const isValid = this.validatePartialResult(output, cmd, options);

					if (!isValid && !(parsedResult instanceof Error)) {
						isResultPrivate = this.hasResultPrivateIp(parsedResult, options.target);
						return;
					}
				} catch (error: unknown) {
					if (error instanceof InternalError && error.expose && error.message?.length > 0) {
						output = error.message;
					} else {
						logger.error(error);
						output = 'Test failed. Please try again.';
					}
				}

				buffer.pushProgress({ rawOutput: output });
			});
		}

		try {
			const cmdResult = await cmd;

			if (cmdResult.stdout.length === 0) {
				logger.error('Successful stdout is empty.', cmdResult);
			}

			const output = this.rewrite(cmdResult.stdout, options.trace);
			const parsedResult = this.parse(output, options.trace);

			if (parsedResult instanceof Error) {
				throw parsedResult;
			}

			isResultPrivate = this.hasResultPrivateIp(parsedResult, options.target);

			result = parsedResult;
		} catch (error: unknown) {
			let output = 'Test failed. Please try again.';

			if (error instanceof InternalError && error.expose) {
				output = error.message;
			} else if (isExecaError(error) && error.stdout.toString().length > 0) {
				output = this.rewrite(error.stdout.toString(), options.trace);
			} else {
				logger.error(error);
			}

			result = {
				status: 'failed',
				rawOutput: output,
			};
		}

		if (isResultPrivate) {
			result = {
				status: 'failed',
				rawOutput: 'Private IP ranges are not allowed',
				...(!options.trace ? { resolver: (result as DnsParseResponseClassic).resolver } : {}),
			};
		}

		buffer.pushResult(this.toJsonOutput(result as DnsParseResponseClassic | DnsParseResponseTrace, options.trace));
	}

	private validatePartialResult (rawOutput: string, cmd: ExecaChildProcess, options: DnsOptions): boolean {
		const result = this.parse(rawOutput, options.trace);

		if (result instanceof Error) {
			return result.message.includes('connection refused');
		}

		if (this.hasResultPrivateIp(result, options.target)) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private toJsonOutput (
		result: DnsParseResponseClassic | DnsParseResponseTrace,
		trace: boolean,
	): DnsParseResponseClassicJson | DnsParseResponseTraceJson {
		if (trace) {
			return TraceDigParser.toJsonOutput({
				...result,
				hops: (result.hops || []) as DnsParseResponseTrace['hops'],
			} as DnsParseResponseTrace);
		}

		return ClassicDigParser.toJsonOutput(result as DnsParseResponseClassic);
	}

	private hasResultPrivateIp (result: DnsParseResponseClassic | DnsParseResponseTrace, target: string): boolean {
		let privateResults = [];

		if (isTrace(result)) {
			privateResults = result.hops
				.flatMap((result: DnsParseLoopResponse) => result.answers)
				.filter((answer: unknown) => isDnsSection(answer) ? isIpPrivate(answer.value as string) : false);
		} else {
			privateResults = result.answers
				.filter((answer: unknown) => isDnsSection(answer) ? isIpPrivate(answer.value as string) : false);
		}

		const isPublicHostname = tldjs.tldExists(target);

		if (privateResults.length > 0 && !isPublicHostname) {
			return true;
		}

		return false;
	}

	private rewrite (rawOutput: string, trace: boolean): string {
		if (!trace) {
			return ClassicDigParser.rewrite(rawOutput);
		}

		return TraceDigParser.rewrite(rawOutput);
	}

	private parse (rawOutput: string, trace: boolean): Error | DnsParseResponseClassic | DnsParseResponseTrace {
		if (!trace) {
			return ClassicDigParser.parse(rawOutput);
		}

		return TraceDigParser.parse(rawOutput);
	}
}
