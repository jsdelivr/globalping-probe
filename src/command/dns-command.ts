import Joi from 'joi';
import isIpPrivate from 'private-ip';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
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
	query: {
		type?: string;
		resolver?: string;
		protocol?: string;
		port?: number;
		trace?: boolean;
	};
};

const isTrace = (output: any): output is DnsParseResponseTrace => Array.isArray((output as DnsParseResponseTrace).result);

const allowedTypes = ['A', 'AAAA', 'ANY', 'CNAME', 'DNSKEY', 'DS', 'MX', 'NS', 'NSEC', 'PTR', 'RRSIG', 'SOA', 'TXT', 'SRV'];
const allowedProtocols = ['UDP', 'TCP'];

const dnsOptionsSchema = Joi.object<DnsOptions>({
	type: Joi.string().valid('dns'),
	target: Joi.string(),
	query: Joi.object({
		type: Joi.string().valid(...allowedTypes).optional().default('A'),
		resolver: Joi.string().optional(),
		protocol: Joi.string().valid(...allowedProtocols).optional().default('udp'),
		port: Joi.number().optional().default('53'),
		trace: Joi.boolean().optional(),
	}),
});

export const dnsCmd = (options: DnsOptions): ExecaChildProcess => {
	const protocolArg = options.query.protocol?.toLowerCase() === 'tcp' ? '+tcp' : [];
	const resolverArg = options.query.resolver ? `@${options.query.resolver}` : [];
	const traceArg = options.query.trace ? '+trace' : [];

	const args = [
		options.target,
		resolverArg,
		['-t', options.query.type],
		['-p', options.query.port],
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
			const isValid = this.validatePartialResult(pStdout.join(''), cmd, Boolean(options.query.trace));

			if (!isValid) {
				isResultPrivate = !isValid;
				return;
			}

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {rawOutput: data.toString()},
			});
		});

		let result = {};

		try {
			const cmdResult = await cmd;
			const parsedResult = this.parse(cmdResult.stdout, Boolean(options.query.trace));

			if (parsedResult instanceof Error) {
				throw parsedResult;
			}

			isResultPrivate = this.hasResultPrivateIp(parsedResult);

			result = parsedResult;
		} catch (error: unknown) {
			const output = isExecaError(error) ? error.stderr.toString() : '';
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
		const parseResult = this.parse(rawOutput, trace);

		if (parseResult instanceof Error) {
			return false;
		}

		if (this.hasResultPrivateIp(parseResult)) {
			cmd.kill('SIGKILL');
			return false;
		}

		return true;
	}

	private hasResultPrivateIp(result: DnsParseResponseClassic | DnsParseResponseTrace): boolean {
		let privateResults = [];

		if (isTrace(result)) {
			privateResults = result.result
				.flatMap((result: DnsParseLoopResponse) => result.answer)
				.filter((answer: unknown) => isDnsSection(answer) ? isIpPrivate(answer.value as string) : false);
		} else {
			privateResults = result.answer
				.filter((answer: unknown) => isDnsSection(answer) ? isIpPrivate(answer.value as string) : false);
		}

		if (privateResults.length > 0) {
			return true;
		}

		return false;
	}

	private parse(rawOutput: string, trace: boolean): Error | DnsParseResponseClassic | DnsParseResponseTrace {
		if (!trace) {
			return ClassicDigParser.parse(rawOutput);
		}

		return TraceDigParser.parse(rawOutput);
	}
}
