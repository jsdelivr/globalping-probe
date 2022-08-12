import isIpPrivate from 'private-ip';
import cryptoRandomString from 'crypto-random-string';
import {InternalError} from '../../../lib/internal-error.js';
import {recordOnBenchmark} from '../../../lib/benchmark/index.js';
import {
	SECTION_REG_EXP,
	NEW_LINE_REG_EXP,
	IPV4_REG_EXP,
	SharedDigParser,
	DnsSection,
	DnsParseLoopResponse,
} from './shared.js';

export type DnsParseResponse = DnsParseLoopResponse & {
	rawOutput: string;
};

/* eslint-disable @typescript-eslint/naming-convention */
const QUERY_TIME_REG_EXP = /Query\s+time:\s+(\d+)/g;
const RESOLVER_REG_EXP = /SERVER:.*\((.*?)\)/g;
/* eslint-enable @typescript-eslint/naming-convention */

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ClassicDigParser = {
	rewrite(rawOutput: string): string {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_rewrite', action: 'start', id: bId});

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

		recordOnBenchmark({type: 'dns_classic_rewrite', action: 'end', id: bId});
		return output;
	},

	parse(rawOutput: string): Error | DnsParseResponse {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_parse', action: 'start', id: bId});

		const lines = rawOutput.split(NEW_LINE_REG_EXP);

		if (lines.length < 6) {
			const message = lines[lines.length - 2];

			if (!message || message.length < 2) {
				recordOnBenchmark({type: 'dns_classic_parse', action: 'end', id: bId});
				return new InternalError(rawOutput, true);
			}

			recordOnBenchmark({type: 'dns_classic_parse', action: 'end', id: bId});
			return new InternalError(message, true);
		}

		recordOnBenchmark({type: 'dns_classic_parse', action: 'end', id: bId});
		return {
			...ClassicDigParser.parseLoop(lines),
			rawOutput,
		};
	},

	parseLoop(lines: string[]): DnsParseLoopResponse {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_parse_loop', action: 'start', id: bId});

		const result: DnsParseLoopResponse = {
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
					result[section]!.push(line);
				} else if (section === 'answer') {
					const sectionResult = ClassicDigParser.parseSection(line.split(/\s+/g), section);
					(result.answers).push(sectionResult);
				}
			}
		}

		recordOnBenchmark({type: 'dns_classic_parse_loop', action: 'end', id: bId});
		return {
			answers: result.answers,
			resolver: result.resolver,
			timings: result.timings,
		};
	},

	parseSection(values: string[], section: string): DnsSection {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_parse_section', action: 'start', id: bId});

		if (!['answer', 'additional'].includes(section)) {
			recordOnBenchmark({type: 'dns_classic_parse_section', action: 'end', id: bId});
			return {};
		}

		recordOnBenchmark({type: 'dns_classic_parse_section', action: 'end', id: bId});
		return SharedDigParser.parseSection(values);
	},

	getQueryTime(line: string): number | undefined {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_get_query_time', action: 'start', id: bId});

		const result = QUERY_TIME_REG_EXP.exec(line);

		if (!result) {
			recordOnBenchmark({type: 'dns_classic_get_query_time', action: 'end', id: bId});
			return;
		}

		recordOnBenchmark({type: 'dns_classic_get_query_time', action: 'end', id: bId});
		return Number(result[1]);
	},

	getResolverServer(line: string): string | undefined {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_get_resolver_server', action: 'start', id: bId});

		const result = RESOLVER_REG_EXP.exec(line);

		if (!result) {
			recordOnBenchmark({type: 'dns_classic_get_resolver_server', action: 'end', id: bId});
			return;
		}

		recordOnBenchmark({type: 'dns_classic_get_resolver_server', action: 'end', id: bId});
		return String(result[1]);
	},
};

export default ClassicDigParser;
