import cryptoRandomString from 'crypto-random-string';
import {recordOnBenchmark} from '../../../lib/benchmark/index.js';
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
	rewrite(rawOutput: string): string {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_rewrite', action: 'start', id: bId});

		const output = rawOutput;

		recordOnBenchmark({type: 'dns_classic_rewrite', action: 'end', id: bId});
		return output;
	},

	parse(rawOutput: string): Error | DnsParseResponse {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_parse', action: 'start', id: bId});

		const lines = rawOutput.split(NEW_LINE_REG_EXP);

		if (lines.length < 3) {
			const message = lines[lines.length - 2];

			if (!message || message.length < 2) {
				return new Error(rawOutput);
			}

			return new Error(message);
		}

		const output = {
			hops: TraceDigParser.parseLoop(lines.slice(2)),
			rawOutput,
		};

		recordOnBenchmark({type: 'dns_classic_parse', action: 'start', id: bId});
		return output;
	},

	parseLoop(lines: string[]): DnsParseLoopResponse[] {
		const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
		recordOnBenchmark({type: 'dns_classic_parse_loop', action: 'start', id: bId});

		const groups: Array<{
			answers: DnsSection[];
			timings: {total: number};
			resolver: string;
		}> = [];

		const pushNewHop = () => {
			groups.push({
				answers: [],
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
			groups[groupIndex]!.answers.push(answer);
		}

		const output = groups.map(item => ({
			...item, answers: item.answers,
		}));

		recordOnBenchmark({type: 'dns_classic_parse_loop', action: 'start', id: bId});
		return output;
	},
};

export default TraceDigParser;
