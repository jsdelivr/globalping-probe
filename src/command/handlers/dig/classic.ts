import isIpPrivate from 'private-ip';
import {InternalError} from '../../../lib/internal-error.js';
import {
	SECTION_REG_EXP,
	NEW_LINE_REG_EXP,
	IPV4_REG_EXP,
	SharedDigParser,
	type DnsSection,
	type DnsParseLoopResponse,
	type DnsParseLoopResponseJson,
} from './shared.js';
import {statusNameToStatusCodeMap} from './dig-status-code-map.js';

type DnsParseLoopResponseClassic = DnsParseLoopResponse & {
	statusCodeName: string;
	statusCode: number | null; // eslint-disable-line @typescript-eslint/ban-types
};

export type DnsParseResponse = DnsParseLoopResponseClassic & {
	status: 'finished' | 'failed';
	rawOutput: string;
};

export type DnsParseResponseJson = DnsParseLoopResponseJson & {
	status: 'finished' | 'failed';
	statusCodeName: string;
	statusCode: number | null; // eslint-disable-line @typescript-eslint/ban-types
	rawOutput: string;
};

/* eslint-disable @typescript-eslint/naming-convention */
const QUERY_TIME_REG_EXP = /Query\s+time:\s+(\d+)/g;
const RESOLVER_REG_EXP = /SERVER:.*\((.*?)\)/g;
const STATUS_CODE_NAME_REG_EXP = /status:\s*([A-Z]+)/g;
/* eslint-enable @typescript-eslint/naming-convention */

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ClassicDigParser = {
	rewrite(rawOutput: string): string {
		const lines = rawOutput.split('\n');

		let output = rawOutput;
		if (lines.length <= 2) {
			const ipMatchList = rawOutput.match(IPV4_REG_EXP) ?? [];

			for (const ip of ipMatchList) {
				if (isIpPrivate(ip) && IPV4_REG_EXP.test(ip)) {
					output = output.replaceAll(ip, 'x.x.x.x');
				}
			}
		} else {
			output = lines.map(line => {
				const serverMatch = ClassicDigParser.getResolverServer(line);

				if (serverMatch && isIpPrivate(serverMatch)) {
					return line.replaceAll(serverMatch, 'x.x.x.x');
				}

				return line;
			}).join('\n');
		}

		return output;
	},

	parse(rawOutput: string): Error | DnsParseResponse {
		const lines = rawOutput.split(NEW_LINE_REG_EXP);

		if (lines.length < 6) {
			const message = lines[lines.length - 2];

			if (!message || message.length < 2) {
				throw new InternalError(rawOutput, true);
			}

			throw new InternalError(message, true);
		}

		return {
			...ClassicDigParser.parseLoop(lines),
			status: 'finished',
			rawOutput,
		};
	},

	toJsonOutput(input: DnsParseResponse): DnsParseResponseJson {
		return {
			status: input.status,
			statusCodeName: input.statusCodeName ?? null,
			statusCode: input.statusCode ?? null,
			rawOutput: input.rawOutput,
			answers: input.answers ?? [],
			timings: {
				...(input.timings ?? {total: 0}),
			},
			resolver: input.resolver ?? null,
		};
	},

	parseLoop(lines: string[]): DnsParseLoopResponseClassic {
		const result: DnsParseLoopResponseClassic = {
			statusCodeName: '',
			statusCode: null,
			header: [],
			answers: [],
			resolver: '',
			timings: {total: 0},
		};

		let section = 'header';
		for (const line of lines) {
			const time = ClassicDigParser.getQueryTime(line);
			if (time !== undefined) {
				result.timings.total = time;
			}

			const statusCodeName = ClassicDigParser.getStatusCodeName(line);
			if (statusCodeName) {
				result.statusCodeName = statusCodeName;
				result.statusCode = statusNameToStatusCodeMap[statusCodeName.toLowerCase()] ?? null;
			}

			const serverMatch = ClassicDigParser.getResolverServer(line);
			if (serverMatch) {
				result.resolver = serverMatch === 'x.x.x.x' ? 'private' : serverMatch;
			}

			let sectionChanged = false;
			if (line.length === 0) {
				section = '';
			} else {
				const sectionMatch = SECTION_REG_EXP.exec(line);

				if (sectionMatch && sectionMatch.length >= 2) {
					section = String(sectionMatch[2]).toLowerCase();
					sectionChanged = true;
				}
			}

			if (!section) {
				continue;
			}

			if (!result[section]) {
				result[section] = [];
			}

			if (!sectionChanged && line) {
				if (section === 'header') {
					result.header!.push(line);
				} else if (section === 'answer') {
					const sectionResult = ClassicDigParser.parseSection(line.split(/\s+/g), section);
					(result.answers).push(sectionResult);
				}
			}
		}

		return {
			statusCodeName: result.statusCodeName,
			statusCode: result.statusCode,
			answers: result.answers,
			resolver: result.resolver,
			timings: result.timings,
		};
	},

	parseSection(values: string[], section: string): DnsSection {
		if (!['answer', 'additional'].includes(section)) {
			return {};
		}

		return SharedDigParser.parseSection(values);
	},

	getQueryTime(line: string): number | undefined {
		const result = QUERY_TIME_REG_EXP.exec(line);

		if (!result) {
			return;
		}

		return Number(result[1]);
	},

	getStatusCodeName(line: string): string | undefined {
		const result = STATUS_CODE_NAME_REG_EXP.exec(line);

		if (!result) {
			return;
		}

		return result[1];
	},

	getResolverServer(line: string): string | undefined {
		const result = RESOLVER_REG_EXP.exec(line);

		if (!result) {
			return;
		}

		return String(result[1]);
	},
};

export default ClassicDigParser;
