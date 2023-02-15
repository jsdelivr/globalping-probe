export type DnsValueType = string | {
	priority: number;
	server: string;
};

export type DnsSection = Record<string, unknown> | {
	name: string;
	type: string;
	ttl: number;
	class: string;
	value: DnsValueType;
};

export type DnsParseLoopResponse = {
	[key: string]: any;
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

/* eslint-disable @typescript-eslint/naming-convention */
export const SECTION_REG_EXP = /(;; )(\S+)( SECTION:)/g;
export const NEW_LINE_REG_EXP = /\r?\n/;
export const IPV4_REG_EXP = /(\b25[0-5]|\b2[0-4]\d|\b[01]?\d{1,2})(\.(25[0-5]|2[0-4]\d|[01]?\d{1,2})){3}/;
/* eslint-enable @typescript-eslint/naming-convention */

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SharedDigParser = {
	parseSection(values: string[]): DnsSection {
		return {
			name: values[0],
			type: values[3],
			ttl: Number(values[1] ?? ''),
			class: values[2],
			value: SharedDigParser.parseValue(values),
		};
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
