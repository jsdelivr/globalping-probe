
export type DnsParseLoopResponse = {
	[key: string]: any;
	question?: any[];
	header: any[];
	answer: any[];
	time: number;
	server: string;
};

export type DnsParseResponse = DnsParseLoopResponse & {
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
					result[section].push(line);
				} else {
					const sectionResult = ClassicDigParser.parseSection(line.split(/\s+/g), section);
					(result[section] as DnsSection[]).push(sectionResult);
				}
			}
		}

		return result;
	},

	parseSection(values: string[], section: string): DnsSection {
		if (!['answer', 'additional'].includes(section)) {
			return {};
		}

		return {
			domain: values[0],
			type: values[3],
			ttl: values[1],
			class: values[2],
			value: ClassicDigParser.parseValue(values),
		};
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

	parseValue(values: string[]): DnsValueType {
		const type = String(values[3]).toUpperCase();

		if (type === 'SOA') {
			return String(values.slice(4)).replace(/,/g, ' ');
		}

		if (type === 'MX') {
			return {priority: Number(values[4]), server: String(values[5])};
		}

		if (type === 'TXT') {
			return String(values.slice(4).join(' '));
		}

		return String(values[values.length - 1]);
	},
};

export default ClassicDigParser;
