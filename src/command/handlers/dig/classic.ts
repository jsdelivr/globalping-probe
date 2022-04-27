import {
	SECTION_REG_EXP,
	NEW_LINE_REG_EXP,
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
	parse(rawOutput: string): Error | DnsParseResponse {
		const lines = rawOutput.split(NEW_LINE_REG_EXP);

		if (lines.length < 6) {
			const message = lines[lines.length - 2];

			if (!message || message.length < 2) {
				return new Error(rawOutput);
			}

			return new Error(message);
		}

		return {
			...ClassicDigParser.parseLoop(lines),
			rawOutput,
		};
	},

	parseLoop(lines: string[]): DnsParseLoopResponse {
		const result: DnsParseLoopResponse = {
			header: [],
			answer: [],
			server: '',
			time: 0,
		};

		let section = 'header';
		for (const line of lines) {
			const time = ClassicDigParser.getQueryTime(line);
			if (time !== undefined) {
				result.time = time;
			}

			const serverMatch = ClassicDigParser.getResolverServer(line);
			if (serverMatch) {
				result.server = serverMatch;
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
				} else {
					const sectionResult = ClassicDigParser.parseSection(line.split(/\s+/g), section);
					(result[section] as DnsSection[]).push(sectionResult);
				}
			}
		}

		return {
			answer: result.answer,
			server: result.server,
			time: result.time,
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

	getResolverServer(line: string): string | undefined {
		const result = RESOLVER_REG_EXP.exec(line);

		if (!result) {
			return;
		}

		return String(result[1]);
	},
};

export default ClassicDigParser;
