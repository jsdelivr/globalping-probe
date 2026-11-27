import {
	NEW_LINE_REG_EXP,
	SharedDigParser,
	type DnsSection,
	type DnsParseLoopResponse,
	type DnsParseLoopResponseJson,
} from './shared.js';
import ClassicDigParser from './classic.js';
import { statusNameToStatusCodeMap } from './dig-status-code-map.js';
import type { FailureSource, TestStatus } from '../../../types.js';

export type DnsParseResponse = {
	status: TestStatus;
	failureSource?: FailureSource;
	hops: DnsParseLoopResponse[];
	rawOutput: string;
};

export type DnsParseResponseJson = {
	status: TestStatus;
	failureSource?: FailureSource;
	hops: DnsParseLoopResponseJson[];
	rawOutput: string;
};

const RESOLVER_REG_EXP = /from.*\((.*?)\)/;
const QUERY_TIME_REG_EXP = /in\s+(\d+)\s+ms/;

export const TraceDigParser = {
	rewrite (rawOutput: string): string {
		const output = rawOutput;
		return output;
	},

	parse (rawOutput: string): Error | DnsParseResponse {
		const lines = rawOutput.split(NEW_LINE_REG_EXP);

		if (lines.length < 3 || lines[0]?.startsWith(';; Got bad packet:')) {
			return new Error(rawOutput);
		}

		return {
			hops: TraceDigParser.parseLoop(lines.slice(2)),
			status: 'finished',
			rawOutput,
		};
	},

	parseLoop (lines: string[]): DnsParseLoopResponse[] {
		const groups: Array<{
			statusCodeName: string | null;
			statusCode: number | null;
			answers: DnsSection[];
			timings: { total: number };
			resolver: string;
		}> = [];

		const pushNewHop = () => {
			groups.push({
				statusCodeName: null,
				statusCode: null,
				answers: [],
				timings: { total: 0 },
				resolver: '',
			});
		};

		pushNewHop();

		for (let i = 0; i < lines.length - 1; i++) {
			const groupIndex = groups.length - 1;
			const line = lines[i];

			if (!line) {
				// The empty line after the "Received" line ends the hop.
				if (groups[groupIndex]!.resolver) {
					pushNewHop();
				}

				continue;
			}

			if (line.startsWith(';;')) {
				const statusCodeName = ClassicDigParser.getStatusCodeName(line);

				if (statusCodeName) {
					groups[groupIndex]!.statusCodeName = statusCodeName;
					groups[groupIndex]!.statusCode = statusNameToStatusCodeMap[statusCodeName.toLowerCase()] ?? null;
				}

				const resolver = RESOLVER_REG_EXP.exec(line);
				const queryTime = QUERY_TIME_REG_EXP.exec(line);

				groups[groupIndex]!.timings.total = queryTime ? Number(queryTime[1]) : 0;
				groups[groupIndex]!.resolver = resolver ? String(resolver[1]) : '';

				continue;
			}

			if (line.startsWith(';')) {
				continue;
			}

			const answer = SharedDigParser.parseSection(line.split(/\s+/g));
			groups[groupIndex]!.answers.push(answer);
		}

		return groups.map(item => ({
			...item, answers: item.answers,
		}));
	},

	toJsonOutput (result: Partial<DnsParseResponse>): DnsParseResponseJson {
		return {
			status: result.status!,
			...(result.status === 'failed' && { failureSource: result.failureSource }),
			rawOutput: result.rawOutput!,
			hops: (result.hops ?? []).map(h => ({
				statusCodeName: h.statusCodeName ?? null,
				statusCode: h.statusCode ?? null,
				answers: h.answers ?? [],
				timings: {
					...(h.timings ?? { total: 0 }),
				},
				resolver: h.resolver ?? null,
			})),
		};
	},
};

export default TraceDigParser;
