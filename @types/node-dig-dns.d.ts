declare module 'node-dig-dns' {
	export type SingleDnsQueryResult = {
		domain: string;
		type: string;
		ttl: number;
		class: string;
		value: string;
	};

	export type DnsQueryResult = {
		answer: SingleDnsQueryResult[];
	};

	export function dig(args: string[]): DnsQueryResult;

	export default dig;
}
