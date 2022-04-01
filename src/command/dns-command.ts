import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess, ExecaError} from 'execa';
import type {CommandInterface} from '../types.js';
import {scopedLogger} from '../lib/logger.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

const logger = scopedLogger('dns');

type DnsOptions = {
	type: 'dns';
	target: string;
	query: {
		type?: string[];
		resolver?: string;
		protocol?: string;
		port?: number;
	};
};

type DnsParseLoopResponse = {
	[key: string]: any;
	question?: any[];
	header: any[];
	answer: any[];
	time: number;
	server: string;
};

type DnsParseResponse = DnsParseLoopResponse & {
	rawOutput: string;
};

type DnsValueType = string | {
	priority: number;
	server: string;
};

type DnsSection = Record<string, unknown> | {
	domain: string;
	type: string;
	ttl: number;
	class: string;
	value: DnsValueType;
};

/* eslint-disable @typescript-eslint/naming-convention */
const SECTION_REG_EXP = /(;; )(\S+)( SECTION:)/g;
const NEW_LINE_REG_EXP = /\r?\n/;
const QUERY_TIME_REG_EXP = /Query\s+time:\s+(\d+)/g;
const RESOLVER_REG_EXP = /SERVER:.*\((.*?)\)/g;
/* eslint-enable @typescript-eslint/naming-convention */

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

	const args = [
		options.target,
		resolverArg,
		['-t', options.query.type],
		['-p', options.query.port],
		'-4',
		'+time=1',
		'+tries=2',
		protocolArg,
	].flat() as string[];

	return execa('dig', args);
};

export class DnsCommand implements CommandInterface<DnsOptions> {
	constructor(private readonly cmd: typeof dnsCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
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
			const parsedResult = this.parse(cmdResult.stdout);

			if (parsedResult instanceof Error) {
				throw parsedResult;
			}

			const {answer, time, server, rawOutput} = parsedResult;
			result = {
				answer, time, server, rawOutput,
			};
		} catch (error: unknown) {
			if (error instanceof Error) {
				// Swallow the error
				logger.debug(error);
				result = {
					rawOutput: '',
				};
			} else {
				result = {
					rawOutput: (error as ExecaError).stderr?.toString() ?? '',
				};
			}
		}

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result,
		});
	}

	private parse(rawOutput: string): Error | DnsParseResponse {
		const lines = rawOutput.split(NEW_LINE_REG_EXP);

		if (lines.length < 6) {
			const message = lines[lines.length - 2];

			if (!message || message.length < 2) {
				return new Error(rawOutput);
			}

			return new Error(message);
		}

		return {
			...this.parseLoop(lines),
			rawOutput,
		};
	}

	private parseLoop(lines: string[]): DnsParseLoopResponse {
		const result: DnsParseLoopResponse = {
			header: [],
			answer: [],
			server: '',
			time: 0,
		};

		let currentSection = 'header';
		for (const line_ of lines) {
			const line = line_;

			const time = this.getQueryTime(line);
			if (time !== undefined) {
				result.time = time;
			}

			const serverMatch = this.getResolverServer(line);
			if (serverMatch) {
				result.server = serverMatch;
			}

			let sectionDetected = false;
			if (line.length === 0) {
				currentSection = '';
			} else {
				const sectionMatch = SECTION_REG_EXP.exec(line);

				if (sectionMatch && sectionMatch.length >= 2) {
					// @ts-expect-error TS is retarded
					currentSection = sectionMatch[2].toLowerCase();
					sectionDetected = true;
				}
			}

			if (!currentSection) {
				continue;
			}

			if (!result[currentSection]) {
				result[currentSection] = [];
			}

			if (!sectionDetected && line) {
				if (currentSection === 'header') {
					result[currentSection].push(line);
				} else {
					const sectionResult = this.parseSection(line.split(/\s+/g), currentSection);
					(result[currentSection] as DnsSection[]).push(sectionResult);
				}
			}
		}

		return result;
	}

	private parseSection(values: string[], section: string): DnsSection {
		if (!['answer', 'additional'].includes(section)) {
			return {};
		}

		return {
			domain: values[0],
			type: values[3],
			ttl: values[1],
			class: values[2],
			value: this.parseType(values),
		};
	}

	private getQueryTime(line: string): number | undefined {
		const result = QUERY_TIME_REG_EXP.exec(line);

		if (!result) {
			return;
		}

		return Number(result[1]);
	}

	private getResolverServer(line: string): string | undefined {
		const result = RESOLVER_REG_EXP.exec(line);

		if (!result) {
			return;
		}

		return String(result[1]);
	}

	private parseType(values: string[]): DnsValueType {
		const type = String(values[3]).toUpperCase();

		if (type === 'SOA') {
			return String(values.slice(4)).replace(/,/g, ' ');
		}

		if (type === 'MX') {
			return {priority: Number(values[4]), server: String(values[5])};
		}

		return String(values[values.length - 1]);
	}
}
