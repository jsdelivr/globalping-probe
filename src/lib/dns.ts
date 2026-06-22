import dns from 'node:dns';
import { isIPv6 } from 'node:net';
import CacheableLookup from 'cacheable-lookup';
import { TTLCache } from '@isaacs/ttlcache';
import QuickLRU from 'quick-lru';
import { isIpPrivate } from './private-ip.js';

type Resolve = (hostname: string, rrtype?: string) => Promise<string[]>;

const DNS_CACHE_MAX_TTL = 5 * 60 * 1000;

export const getDnsServers = (getServers: () => string[] = dns.getServers): string[] => {
	const servers = getServers();

	return servers
		// Hide private ips
		.map((addr: string) => {
			let ip = addr.replace('[', '').replace(/]:\d{1,5}$/, ''); // removes port number if it is ipv6
			ip = isIPv6(ip) ? ip : ip.replace(/:\d{1,5}$/, ''); // removes port number if it is not ipv6
			return isIpPrivate(ip) ? 'private' : ip;
		});
};

export const cachedLookup = new CacheableLookup({
	cache: new QuickLRU({ maxSize: 1000 }),
	maxTtl: DNS_CACHE_MAX_TTL / 1000,
});

const resolveCache = new TTLCache<string, Promise<string[]>>({
	max: 1000,
	ttl: DNS_CACHE_MAX_TTL,
});

export const cachedResolve = (resolve: Resolve, hostname: string, rrtype?: string): Promise<string[]> => {
	const key = `${rrtype ?? 'A'}:${hostname}`;
	const cached = resolveCache.get(key);

	if (cached) {
		return cached;
	}

	const pending = resolve(hostname, rrtype).catch((error: unknown) => {
		resolveCache.delete(key);
		throw error;
	});

	resolveCache.set(key, pending);

	return pending;
};

export const clearDnsCache = () => resolveCache.clear();
