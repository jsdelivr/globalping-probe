import dns from 'node:dns';
import { isIPv6 } from 'node:net';
import { TTLCache } from '@isaacs/ttlcache';
import { isIpPrivate } from './private-ip.js';
import { InternalError } from './internal-error.js';

export type IpFamily = 4 | 6;

export type LookupOptions = { family: IpFamily; server?: string; allowPrivate?: boolean };
export type RecordOptions = { rrtype: 'TXT'; server?: string };
type Options = LookupOptions | RecordOptions;

type ResolvedRecords = { records: string[]; ttl: number };

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

const resolveRecords = async (hostname: string, options: Options): Promise<ResolvedRecords> => {
	const resolver = new dns.promises.Resolver();

	if (options.server) {
		resolver.setServers([ options.server ]);
	}

	try {
		if ('rrtype' in options) {
			// Only TXT records are supported as other RRtypes have different TS return types.
			const records = (await resolver.resolveTxt(hostname)).map(record => record.join(''));
			// TXT records carry no TTL here, so they fall back to the max cache TTL.
			return { records, ttl: DNS_CACHE_MAX_TTL };
		}

		const records = options.family === 6
			? await resolver.resolve6(hostname, { ttl: true })
			: await resolver.resolve4(hostname, { ttl: true });

		let ttl = DNS_CACHE_MAX_TTL;

		if (records.length) {
			const minResolvedTtl = Math.min(DNS_CACHE_MAX_TTL, Math.min(...records.map(record => record.ttl)) * 1000);
			// TTL: 0 is invalid, so we set it to 1.
			ttl = Math.max(1, minResolvedTtl);
		}

		return { records: records.map(record => record.address), ttl };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		const failureSource = code === 'ENOTFOUND' || code === 'ENODATA' ? 'target' : 'resolver';

		throw new InternalError((error as Error).message, true, failureSource);
	}
};

const cachedResolveRecords = (hostname: string, options: Options): Promise<string[]> => {
	const key = `${'rrtype' in options ? options.rrtype : options.family}:${options.server ?? ''}:${hostname}`;
	const cached = cache.get(key);

	if (cached) {
		return cached;
	}

	const pending = resolveRecords(hostname, options).then(({ records, ttl }) => {
		if (cache.has(key)) {
			cache.setTTL(key, ttl);
		}

		return records;
	}).catch((error: unknown) => {
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
		throw new InternalError(`ENODATA ${hostname}`, true, 'target');
	}

	const address = options.allowPrivate ? records[0] : records.find(ip => !isIpPrivate(ip));

	if (!address) {
		throw new InternalError('Private IP ranges are not allowed.', true, 'target');
	}

	return [ address, options.family ];
};

export function dnsLookup (hostname: string, options: LookupOptions): Promise<[string, IpFamily]>;
export function dnsLookup (hostname: string, options: RecordOptions): Promise<string[]>;

export async function dnsLookup (hostname: string, options: Options): Promise<[string, IpFamily] | string[]> {
	const { records } = await resolveRecords(hostname, options);
	return toResult(records, hostname, options);
}

export function cachedDnsLookup (hostname: string, options: LookupOptions): Promise<[string, IpFamily]>;
export function cachedDnsLookup (hostname: string, options: RecordOptions): Promise<string[]>;

export async function cachedDnsLookup (hostname: string, options: Options): Promise<[string, IpFamily] | string[]> {
	return toResult(await cachedResolveRecords(hostname, options), hostname, options);
}
