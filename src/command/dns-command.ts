import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

import ClassicDigParser from './handlers/dig/classic.js';
import type {DnsParseResponse as DnsParseResponseClassic} from './handlers/dig/classic.js';
import TraceDigParser from './handlers/dig/trace.js';
import type {DnsParseResponse as DnsParseResponseTrace} from './handlers/dig/trace.js';

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

	return execa('dig', args);
};

export class DnsCommand implements CommandInterface<DnsOptions> {
	constructor(private readonly cmd: typeof dnsCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: DnsOptions): Promise<void> {
		const {value: cmdOptions, error} = dnsOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('dns', error);
		}

		const cmd = this.cmd(cmdOptions);
		cmd.stdout?.on('data', (data: Buffer) => {
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

			result = parsedResult;
		} catch (error: unknown) {
			const output = isExecaError(error) ? error.stderr.toString() : '';
			result = {
				rawOutput: output,
			};
		}

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result,
		});
	}

	private parse(rawOutput: string, trace: boolean): Error | DnsParseResponseClassic | DnsParseResponseTrace {
		if (!trace) {
			return ClassicDigParser.parse(rawOutput);
		}

		return TraceDigParser.parse(rawOutput);
	}
}
