import ipRegex from 'ip-regex';

export type DnsValueType = string;

export type DnsSection = Record<string, unknown> | {
	name: string | null;
	type: string | null;
	ttl: number;
	class: string| null;
	value: DnsValueType;
};

export type DnsParseLoopResponse = {
	[key: string]: unknown;
	header?: string[];
	answers: DnsSection[];
	timings: {total: number};
	resolver: string;
};

/* eslint-disable @typescript-eslint/ban-types */
export type DnsParseLoopResponseJson = {
	answers: DnsSection[];
	timings: {total: number | null};
	resolver: string | null;
};
/* eslint-enable @typescript-eslint/ban-types */

export const isDnsSection = (output: unknown): output is DnsSection => typeof (output as DnsSection) !== 'undefined';

export const SECTION_REG_EXP = /(;; )(\S+)( SECTION:)/g;
export const NEW_LINE_REG_EXP = /\r?\n/;
export const IP_REG_EXP = ipRegex();

export const SharedDigParser = {
	parseSection (values: string[]): DnsSection {
		return {
			name: values[0] ?? null,
			type: values[3] ?? null,
			ttl: Number(values[1] ?? ''),
			class: values[2] ?? null,
			value: SharedDigParser.parseValue(values),
		};
	},

	parseValue (values: string[]): DnsValueType {
		return String(values.slice(4).join(' '));
	},
};
