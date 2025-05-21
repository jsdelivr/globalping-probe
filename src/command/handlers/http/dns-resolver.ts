import dns, { type RecordWithTtl } from 'node:dns';
import { isIpPrivate } from '../../../lib/private-ip.js';

export type IpFamily = 4 | 6;
export type Options = {
	family: IpFamily;
};
export type ErrnoException = NodeJS.ErrnoException;
export type ResolverOptionsType = { ttl: boolean };
export type ResolverType = (hostname: string, options: ResolverOptionsType) => Promise<string[]>;

const isRecordWithTtl = (record: unknown): record is RecordWithTtl => Boolean((record as RecordWithTtl).ttl);

export const buildResolver = (resolverAddr: string | undefined, family: IpFamily): ResolverType => {
	const resolver = new dns.promises.Resolver();

	if (resolverAddr) {
		resolver.setServers([ resolverAddr ]);
	}

	const resolve = family === 6 ? resolver.resolve6.bind(resolver) : resolver.resolve4.bind(resolver);

	return resolve;
};

export const dnsLookup = (resolverAddr: string | undefined, resolverFn?: ResolverType) => async (
	hostname: string,
	options: Options,
): Promise<Error | ErrnoException | [string, number]> => {
	const resolver = resolverFn ?? buildResolver(resolverAddr, options.family);

	const result = await resolver(hostname, { ttl: false });

	const validIps = result.map(r => isRecordWithTtl(r) ? r.address : r).filter(r => !isIpPrivate(r));

	if (validIps.length === 0) {
		throw new Error(`ENODATA ${hostname}`);
	}

	return [ validIps[0]!, options.family ];
};
