import dns from 'node:dns';
import { isIPv6 } from 'node:net';
import { TTLCache } from '@isaacs/ttlcache';
import { isIpPrivate } from './private-ip.js';
import { InternalError } from './internal-error.js';

export type IpFamily = 4 | 6;

export type LookupOptions = { family: IpFamily; server?: string };
export type RecordOptions = { rrtype: 'TXT'; server?: string };
type Options = LookupOptions | RecordOptions;

const DNS_CACHE_MAX_TTL = 5 * 60 * 1000;

const cache = new TTLCache<string, Promise<string[]>>({
	max: 1000,
	ttl: DNS_CACHE_MAX_TTL,
});

export const clearDnsCache = () => cache.clear();

export const getDnsServers = (getServers: () => string[] = dns.getServers): string[] => {
	return getServers()
		// Hide private ips
		.map((addr: string) => {
			let ip = addr.replace('[', '').replace(/]:\d{1,5}$/, ''); // removes port number if it is ipv6
			ip = isIPv6(ip) ? ip : ip.replace(/:\d{1,5}$/, ''); // removes port number if it is not ipv6
			return isIpPrivate(ip) ? 'private' : ip;
		});
};

const resolveRecords = async (hostname: string, options: Options): Promise<string[]> => {
	const resolver = new dns.promises.Resolver();

	if (options.server) {
		resolver.setServers([ options.server ]);
	}

	try {
		if ('rrtype' in options) {
			// Only TXT records are supported as other types have different return types.
			return (await resolver.resolveTxt(hostname)).map(record => record.join(''));
		}

		return options.family === 6 ? await resolver.resolve6(hostname) : await resolver.resolve4(hostname);
	} catch (error) {
		throw new InternalError((error as Error).message);
	}
};

const cachedResolveRecords = (hostname: string, options: Options): Promise<string[]> => {
	const key = `${'rrtype' in options ? options.rrtype : options.family}:${options.server ?? ''}:${hostname}`;
	const cached = cache.get(key);

	if (cached) {
		return cached;
	}

	const pending = resolveRecords(hostname, options).catch((error: unknown) => {
		cache.delete(key);
		throw error;
	});

	cache.set(key, pending);

	return pending;
};

const toResult = (records: string[], hostname: string, options: Options): [string, IpFamily] | string[] => {
	if ('rrtype' in options) {
		return records;
	}

	if (!records.length) {
		throw new InternalError(`ENODATA ${hostname}`);
	}

	const address = records.find(ip => !isIpPrivate(ip));

	if (!address) {
		throw new InternalError('Private IP ranges are not allowed.');
	}

	return [ address, options.family ];
};

export function dnsLookup (hostname: string, options: LookupOptions): Promise<[string, IpFamily]>;
export function dnsLookup (hostname: string, options: RecordOptions): Promise<string[]>;

export async function dnsLookup (hostname: string, options: Options): Promise<[string, IpFamily] | string[]> {
	return toResult(await resolveRecords(hostname, options), hostname, options);
}

export function cachedDnsLookup (hostname: string, options: LookupOptions): Promise<[string, IpFamily]>;
export function cachedDnsLookup (hostname: string, options: RecordOptions): Promise<string[]>;

export async function cachedDnsLookup (hostname: string, options: Options): Promise<[string, IpFamily] | string[]> {
	return toResult(await cachedResolveRecords(hostname, options), hostname, options);
}
