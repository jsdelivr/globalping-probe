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
		time: number;
		server: string;
	};

	export function dig (args: string[]): Promise<DnsQueryResult>;

	export default dig;
}
