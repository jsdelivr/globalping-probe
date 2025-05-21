import ipRegex from 'ip-regex';

export type DnsValueType = string;

export type DnsSection = Record<string, never> | {
	name: string;
	type: string;
	ttl: number;
	class: string;
	value: DnsValueType;
};

export type DnsParseLoopResponse = {
	[key: string]: unknown;
	header?: string[];
	answers: DnsSection[];
	timings: { total: number };
	resolver: string;
};

export type DnsParseLoopResponseJson = {
	answers: DnsSection[];
	timings: { total: number | null };
	resolver: string | null;
};

export const isDnsSection = (output: unknown): output is DnsSection => typeof (output as DnsSection) !== 'undefined';

export const SECTION_REG_EXP = /(;; )(\S+)( SECTION:)/g;
export const NEW_LINE_REG_EXP = /\r?\n/;
export const IP_REG_EXP = ipRegex();

export const SharedDigParser = {
	parseSection (values: string[]): DnsSection {
		return {
			name: values[0]!,
			type: values[3]!,
			ttl: Number(values[1] ?? ''),
			class: values[2]!,
			value: SharedDigParser.parseValue(values),
		};
	},

	parseValue (values: string[]): DnsValueType {
		return String(values.slice(4).join(' '));
	},
};
