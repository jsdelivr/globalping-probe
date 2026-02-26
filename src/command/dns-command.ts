import config from 'config';
import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import tldts from 'tldts';
import type { CommandInterface } from '../types.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { byLine } from '../lib/by-line.js';
import { isIpPrivate } from '../lib/private-ip.js';
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
	ipVersion: number;
};

export type DnsParseResponseJson = DnsParseResponseClassicJson | DnsParseResponseTraceJson;

const logger = scopedLogger('dns-command');

const isTrace = (output: unknown): output is DnsParseResponseTrace => Array.isArray((output as DnsParseResponseTrace).hops);

const allowedTypes = [ 'A', 'AAAA', 'ANY', 'CNAME', 'DNSKEY', 'DS', 'HTTPS', 'MX', 'NS', 'NSEC', 'PTR', 'RRSIG', 'SOA', 'TXT', 'SRV', 'SVCB' ];
const allowedProtocols = [ 'UDP', 'TCP' ];
const allowedIpVersions = [ 4, 6 ];

const dnsOptionsSchema = Joi.object<DnsOptions>({
	type: Joi.string().valid('dns'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string().required(),
	resolver: Joi.string().optional(),
	protocol: Joi.string().valid(...allowedProtocols).optional().default('udp'),
	port: Joi.number().optional().default('53'),
	trace: Joi.boolean().optional().default(false),
	query: Joi.object({
		type: Joi.string().valid(...allowedTypes).optional().default('A'),
	}),
	ipVersion: Joi.when(Joi.ref('resolver'), {
		is: Joi.string().ip({ version: [ 'ipv4' ], cidr: 'forbidden' }).required(),
		then: Joi.valid(4).default(4),
		otherwise: Joi.when(Joi.ref('resolver'), {
			is: Joi.string().ip({ version: [ 'ipv6' ], cidr: 'forbidden' }).required(),
			then: Joi.valid(6).default(6),
			otherwise: Joi.valid(...allowedIpVersions).default(4),
		}),
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
		`-${options.ipVersion}`,
		'+timeout=3',
		'+tries=2',
		'+nocookie',
		'+nosplit',
		'+nsid',
		traceArg,
		protocolArg,
	].flat();

	return args;
};

export const dnsCmd = (options: DnsOptions): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', [ 'dig', ...args ], { timeout: config.get<number>('commands.timeout') * 1000 });
};

export class DnsCommand implements CommandInterface<DnsOptions> {
	constructor (private readonly cmd: typeof dnsCmd) {}

	async run (socket: Socket, measurementId: string, testId: string, options: DnsOptions): Promise<unknown> {
		const validationResult = dnsOptionsSchema.validate(options);

		if (validationResult.error) {
			throw new InvalidOptionsException('dns', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'diff');
		let isResultPrivate = false;
		let result: Partial<DnsParseResponseClassic | DnsParseResponseTrace> = {};

		const cmd = this.cmd(cmdOptions);

		if (cmd.stdout && cmdOptions.inProgressUpdates) {
			const pStdout: string[] = [];
			byLine(cmd.stdout, (data: string) => {
				pStdout.push(data);

				let output = '';

				try {
					output = this.rewrite(pStdout.join(''), cmdOptions.trace);
					const parsedResult = this.parse(output, cmdOptions.trace);
					const isValid = this.validatePartialResult(parsedResult, cmd, cmdOptions);

					if (!isValid && !(parsedResult instanceof Error)) {
						isResultPrivate = this.hasResultPrivateIp(parsedResult, cmdOptions.target);
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

			const output = this.rewrite(cmdResult.stdout, cmdOptions.trace);
			const parsedResult = this.parse(output, cmdOptions.trace);

			if (parsedResult instanceof Error) {
				throw parsedResult;
			}

			isResultPrivate = this.hasResultPrivateIp(parsedResult, cmdOptions.target);

			result = parsedResult;
		} catch (error: unknown) {
			let output = 'Test failed. Please try again.';

			if (error instanceof InternalError && error.expose) {
				output = error.message;
			} else if (isExecaError(error) && error.timedOut) {
				output = this.rewrite(error.stdout.toString(), cmdOptions.trace) + '\n\nThe measurement command timed out.';
			} else if (isExecaError(error) && error.stdout.toString().length > 0) {
				output = this.rewrite(error.stdout.toString(), cmdOptions.trace);
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
				rawOutput: 'Private IP ranges are not allowed.',
				...(!cmdOptions.trace ? { resolver: (result as DnsParseResponseClassic).resolver } : {}),
			};
		}

		const out = this.toJsonOutput(result, cmdOptions.trace);
		buffer.pushResult(out);
		return out;
	}

	private validatePartialResult (parsedResult: Error | DnsParseResponseClassic | DnsParseResponseTrace, cmd: ExecaChildProcess, options: DnsOptions): boolean {
		if (parsedResult instanceof Error) {
			return parsedResult.message.includes('connection refused');
		}

		if (this.hasResultPrivateIp(parsedResult, options.target)) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private toJsonOutput (result: Partial<DnsParseResponseClassic | DnsParseResponseTrace>, trace: boolean): DnsParseResponseJson {
		if (trace) {
			return TraceDigParser.toJsonOutput(result as Partial<DnsParseResponseTrace>);
		}

		return ClassicDigParser.toJsonOutput(result as Partial<DnsParseResponseClassic>);
	}

	private hasResultPrivateIp (result: DnsParseResponseClassic | DnsParseResponseTrace, target: string): boolean {
		let privateResults = [];

		if (isTrace(result)) {
			privateResults = result.hops
				.flatMap((result: DnsParseLoopResponse) => result.answers)
				.filter((answer: unknown) => isDnsSection(answer) ? isIpPrivate(answer.value) : false);
		} else {
			privateResults = result.answers
				.filter((answer: unknown) => isDnsSection(answer) ? isIpPrivate(answer.value) : false);
		}

		if (privateResults.length > 0 && !(tldts.parse(target).isIcann)) {
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
