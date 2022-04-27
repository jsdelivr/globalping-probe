import {
	NEW_LINE_REG_EXP,
	SharedDigParser,
	DnsSection,
} from './shared.js';

export type DnsParseLoopResponse = {
	[key: string]: any;
	question?: any[];
	answer: DnsSection[];
	time: number;
	server: string;
};

export type DnsParseResponse = {
	result: DnsParseLoopResponse[];
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
			result: TraceDigParser.parseLoop(lines.slice(2)),
			rawOutput,
		};
	},

	parseLoop(lines: string[]): DnsParseLoopResponse[] {
		const groups = [];

		for (let i = 0; i < lines.length - 1; i++) {
			const line = lines[lines.length - 1 - i];

			if (!line) {
				continue;
			}

			if (line.startsWith(';;')) {
				const resolver = RESOLVER_REG_EXP.exec(line);
				const queryTime = QUERY_TIME_REG_EXP.exec(line);

				groups.push({
					time: queryTime ? Number(queryTime[1]) : 0,
					server: resolver ? String(resolver[1]) : '',
					answer: [] as DnsSection[],
				});

				continue;
			}

			const groupIndex = groups.length - 1;

			const answer = SharedDigParser.parseSection(line.split(/\s+/g));
			groups[groupIndex]!.answer.push(answer);
		}

		return groups.reverse().map(item => ({...item, answer: item.answer.reverse()}));
	},
};

export default TraceDigParser;
