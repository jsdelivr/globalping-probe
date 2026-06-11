import CacheableLookup from 'cacheable-lookup';
import { TTLCache } from '@isaacs/ttlcache';

type Resolve = (hostname: string, rrtype?: string) => Promise<string[]>;

export const cachedLookup = new CacheableLookup({ maxTtl: 5 * 60 });

export const createCachedResolve = (resolve: Resolve): Resolve => {
	const cache = new TTLCache<string, Promise<string[]>>({
		max: 5000,
		ttl: 5 * 60 * 1000,
	});

	return (hostname, rrtype) => {
		const key = `${rrtype ?? 'A'}:${hostname}`;
		const cached = cache.get(key);

		if (cached) {
			return cached;
		}

		const pending = resolve(hostname, rrtype).catch((error: unknown) => {
			cache.delete(key);
			throw error;
		});

		cache.set(key, pending);

		return pending;
	};
};
