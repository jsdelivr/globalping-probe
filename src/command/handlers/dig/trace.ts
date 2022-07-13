import {
	NEW_LINE_REG_EXP,
	SharedDigParser,
	DnsSection,
	DnsParseLoopResponse,
} from './shared.js';

export type DnsParseResponse = {
	hops: DnsParseLoopResponse[];
	rawOutput: string;
};

/* eslint-disable @typescript-eslint/naming-convention */
const RESOLVER_REG_EXP = /from.*\((.*?)\)/;
const QUERY_TIME_REG_EXP = /in\s+(\d+)\s+ms/;
/* eslint-enable @typescript-eslint/naming-convention */

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TraceDigParser = {
	parse(rawOutput: string): Error | DnsParseResponse {
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
			rawOutput,
		};
	},

	parseLoop(lines: string[]): DnsParseLoopResponse[] {
		const groups: Array<{
			answer: DnsSection[];
			timings: {total: number};
			resolver: string;
		}> = [];

		const pushNewHop = () => {
			groups.push({
				answer: [],
				timings: {total: 0},
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
			groups[groupIndex]!.answer.push(answer);
		}

		return groups.map(item => ({...item, answer: item.answer}));
	},
};

export default TraceDigParser;
