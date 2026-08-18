import dns from 'node:dns';
import { isIPv6 } from 'node:net';
import { TTLCache } from '@isaacs/ttlcache';
import { isIpPrivate } from './ip.js';
import { InternalError } from './internal-error.js';

export type IpFamily = 4 | 6;

export type LookupOptions = { family: IpFamily; server?: string; allowPrivate?: boolean; signal?: AbortSignal };
export type RecordOptions = { rrtype: 'TXT' | 'PTR'; server?: string; signal?: AbortSignal };
type Options = LookupOptions | RecordOptions;

type ResolvedRecords = { records: string[]; ttl: number };

const DNS_CACHE_MIN_TTL = 60 * 1000;
const DNS_CACHE_TXT_TTL = 5 * 60 * 1000;
const DNS_CACHE_MAX_ENTRIES = 5000;

const cache = new TTLCache<string, Promise<string[]>>({
	max: DNS_CACHE_MAX_ENTRIES,
	ttl: DNS_CACHE_TXT_TTL,
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
	const servers: Array<string | undefined> = options.server ? [ options.server ] : resolver.getServers();

	// Keep the resolver's default behavior if the system has no configured servers.
	if (!servers.length) {
		servers.push(undefined);
	}

	for (const [ index, server ] of servers.entries()) {
		if (server) {
			resolver.setServers([ server ]);
		}

		try {
			if ('rrtype' in options) {
				const records = options.rrtype === 'PTR'
					? await resolver.reverse(hostname)
					: (await resolver.resolveTxt(hostname)).map(record => record.join(''));
				// TXT and PTR records carry no TTL here, so they use a fixed cache TTL.
				return { records, ttl: DNS_CACHE_TXT_TTL };
			}

			const records = options.family === 6
				? await resolver.resolve6(hostname, { ttl: true })
				: await resolver.resolve4(hostname, { ttl: true });

			let ttl = DNS_CACHE_MIN_TTL;

			if (records.length) {
				const minResolvedTtl = Math.min(...records.map(record => record.ttl)) * 1000;
				ttl = Math.max(DNS_CACHE_MIN_TTL, minResolvedTtl);
			}

			return { records: records.map(record => record.address), ttl };
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			const isTargetFailure = code === 'ENOTFOUND' || code === 'ENODATA';

			if (!isTargetFailure && index < servers.length - 1) {
				continue;
			}

			throw new InternalError((error as Error).message, true, isTargetFailure ? 'target' : 'resolver');
		}
	}

	throw new InternalError('DNS lookup failed.', true, 'resolver');
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

const waitForRecords = async (promise: Promise<string[]>, signal?: AbortSignal): Promise<string[]> => {
	if (!signal) {
		return promise;
	}

	const abortError = () => signal.reason instanceof Error ? signal.reason : new Error('DNS lookup aborted.');

	if (signal.aborted) {
		throw abortError();
	}

	let abort: () => void;
	const abortPromise = new Promise<never>((_resolve, reject) => {
		abort = () => reject(abortError());
		signal.addEventListener('abort', abort, { once: true });
	});

	try {
		return await Promise.race([ promise, abortPromise ]);
	} finally {
		signal.removeEventListener('abort', abort!);
	}
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
	const records = resolveRecords(hostname, options).then(result => result.records);
	return toResult(await waitForRecords(records, options.signal), hostname, options);
}

export function cachedDnsLookup (hostname: string, options: LookupOptions): Promise<[string, IpFamily]>;
export function cachedDnsLookup (hostname: string, options: RecordOptions): Promise<string[]>;

export async function cachedDnsLookup (hostname: string, options: Options): Promise<[string, IpFamily] | string[]> {
	return toResult(await waitForRecords(cachedResolveRecords(hostname, options), options.signal), hostname, options);
}
