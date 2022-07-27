import Joi from 'joi';
import isIpPrivate from 'private-ip';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {InternalError} from '../lib/internal-error.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

import ClassicDigParser from './handlers/dig/classic.js';
import type {DnsParseResponse as DnsParseResponseClassic} from './handlers/dig/classic.js';
import TraceDigParser from './handlers/dig/trace.js';
import type {DnsParseResponse as DnsParseResponseTrace} from './handlers/dig/trace.js';
import {isDnsSection} from './handlers/dig/shared.js';
import type {DnsParseLoopResponse} from './handlers/dig/shared.js';

type DnsOptions = {
	type: 'dns';
	target: string;
	protocol?: string;
	port?: number;
	resolver?: string;
	trace?: boolean;
	query: {
		type?: string;
	};
};

const isTrace = (output: any): output is DnsParseResponseTrace => Array.isArray((output as DnsParseResponseTrace).hops);

const allowedTypes = ['A', 'AAAA', 'ANY', 'CNAME', 'DNSKEY', 'DS', 'MX', 'NS', 'NSEC', 'PTR', 'RRSIG', 'SOA', 'TXT', 'SRV'];
const allowedProtocols = ['UDP', 'TCP'];

const dnsOptionsSchema = Joi.object<DnsOptions>({
	type: Joi.string().valid('dns'),
	target: Joi.string(),
	resolver: Joi.string().optional(),
	protocol: Joi.string().valid(...allowedProtocols).optional().default('udp'),
	port: Joi.number().optional().default('53'),
	trace: Joi.boolean().optional(),
	query: Joi.object({
		type: Joi.string().valid(...allowedTypes).optional().default('A'),
	}),
});

export const dnsCmd = (options: DnsOptions): ExecaChildProcess => {
	const protocolArg = options.protocol?.toLowerCase() === 'tcp' ? '+tcp' : [];
	const resolverArg = options.resolver ? `@${options.resolver}` : [];
	const traceArg = options.trace ? '+trace' : [];

	const args = [
		options.target,
		resolverArg,
		['-t', options.query.type],
		['-p', options.port],
		'-4',
		'+timeout=3',
		'+tries=2',
		'+nocookie',
		traceArg,
		protocolArg,
	].flat() as string[];

	return execa('unbuffer', ['dig', ...args]);
};

export class DnsCommand implements CommandInterface<DnsOptions> {
	constructor(private readonly cmd: typeof dnsCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: DnsOptions): Promise<void> {
		const {value: cmdOptions, error} = dnsOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('dns', error);
		}

		const pStdout: string[] = [];
		let isResultPrivate = false;

		const cmd = this.cmd(cmdOptions);
		cmd.stdout?.on('data', (data: Buffer) => {
			pStdout.push(data.toString());
			const output = this.rewrite(data.toString(), Boolean(options.trace));
			const isValid = this.validatePartialResult(output, cmd, Boolean(options.trace));

			if (!isValid) {
				isResultPrivate = !isValid;
				return;
			}

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {
					rawOutput: output,
				},
			});
		});

		let result = {};

		try {
			const cmdResult = await cmd;
			const output = this.rewrite(cmdResult.stdout, Boolean(options.trace));
			const parsedResult = this.parse(output, Boolean(options.trace));

			if (parsedResult instanceof Error) {
				throw parsedResult;
			}

			isResultPrivate = this.hasResultPrivateIp(parsedResult);

			result = parsedResult;
		} catch (error: unknown) {
			let output = '';

			if (error instanceof InternalError && error.expose) {
				output = error.message;
			} else if (isExecaError(error)) {
				output = this.rewrite(error.stdout.toString(), Boolean(options.trace));
			}

			result = {
				rawOutput: output,
			};
		}

		if (isResultPrivate) {
			result = {
				rawOutput: 'Private IP ranges are not allowed',
			};
		}

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result,
		});
	}

	private validatePartialResult(rawOutput: string, cmd: ExecaChildProcess, trace: boolean): boolean {
		const result = this.parse(rawOutput, trace);

		if (result instanceof Error) {
			return result.message.includes('connection refused');
		}

		if (this.hasResultPrivateIp(result)) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private hasResultPrivateIp(result: DnsParseResponseClassic | DnsParseResponseTrace): boolean {
		let privateResults = [];

		if (isTrace(result)) {
			privateResults = result.hops
				.flatMap((result: DnsParseLoopResponse) => result.answers)
				.filter((answer: unknown) => isDnsSection(answer) ? isIpPrivate(answer.value as string) : false);
		} else {
			privateResults = result.answers
				.filter((answer: unknown) => isDnsSection(answer) ? isIpPrivate(answer.value as string) : false);
		}

		if (privateResults.length > 0) {
			return true;
		}

		return false;
	}

	private rewrite(rawOutput: string, trace: boolean): string {
		if (!trace) {
			return ClassicDigParser.rewrite(rawOutput);
		}

		return TraceDigParser.rewrite(rawOutput);
	}

	private parse(rawOutput: string, trace: boolean): Error | DnsParseResponseClassic | DnsParseResponseTrace {
		if (!trace) {
			return ClassicDigParser.parse(rawOutput);
		}

		return TraceDigParser.parse(rawOutput);
	}
}
