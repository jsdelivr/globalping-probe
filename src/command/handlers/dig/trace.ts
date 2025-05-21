import {
	NEW_LINE_REG_EXP,
	SharedDigParser,
	type DnsSection,
	type DnsParseLoopResponse,
	type DnsParseLoopResponseJson,
} from './shared.js';

export type DnsParseResponse = {
	status: 'finished' | 'failed';
	hops: DnsParseLoopResponse[];
	rawOutput: string;
};

export type DnsParseResponseJson = {
	status: 'finished' | 'failed';
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

		if (lines.length < 3) {
			const message = lines[lines.length - 2];

			if (!message || message.length < 2) {
				return new Error(rawOutput);
			}

			return new Error(message);
		}

		return {
			hops: TraceDigParser.parseLoop(lines.slice(2)),
			status: 'finished',
			rawOutput,
		};
	},

	parseLoop (lines: string[]): DnsParseLoopResponse[] {
		const groups: Array<{
			answers: DnsSection[];
			timings: { total: number };
			resolver: string;
		}> = [];

		const pushNewHop = () => {
			groups.push({
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
				pushNewHop();
				continue;
			}

			if (line.startsWith(';;')) {
				const resolver = RESOLVER_REG_EXP.exec(line);
				const queryTime = QUERY_TIME_REG_EXP.exec(line);

				groups[groupIndex]!.timings.total = queryTime ? Number(queryTime[1]) : 0;
				groups[groupIndex]!.resolver = resolver ? String(resolver[1]) : '';

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
			rawOutput: result.rawOutput!,
			hops: (result.hops ?? []).map(h => ({
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
