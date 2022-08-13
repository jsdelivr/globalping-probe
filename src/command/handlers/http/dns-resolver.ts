import dns, {RecordWithTtl} from 'node:dns';
import isIpPrivate from 'private-ip';
import cryptoRandomString from 'crypto-random-string';
import {recordOnBenchmark} from '../../../lib/benchmark/index.js';

type IpFamily = 4 | 6;
type Options = {
	family: IpFamily;
};
type ErrnoException = NodeJS.ErrnoException;
export type ResolverOptionsType = {ttl: boolean};
export type ResolverType = (hostname: string, options: ResolverOptionsType) => Promise<string[]>;

const isRecordWithTtl = (record: unknown): record is RecordWithTtl => Boolean((record as RecordWithTtl).ttl);

export const buildResolver = (resolverAddr: string | undefined, family: IpFamily): ResolverType => {
	const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
	recordOnBenchmark({type: 'http_build_resolver', action: 'start', id: bId});

	const resolver = new dns.promises.Resolver();

	if (resolverAddr) {
		resolver.setServers([resolverAddr]);
	}

	const resolve = family === 6 ? resolver.resolve6.bind(resolver) : resolver.resolve4.bind(resolver);

	recordOnBenchmark({type: 'http_build_resolver', action: 'end', id: bId});
	return resolve;
};

export const dnsLookup = (resolverAddr: string | undefined, resolverFn?: ResolverType) => async (
	hostname: string,
	options: Options,
): Promise<Error | ErrnoException | [string, number]> => {
	const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
	recordOnBenchmark({type: 'http_dns_lookup', action: 'start', id: bId});

	const resolver = resolverFn ?? buildResolver(resolverAddr, options.family);

	try {
		const result = await resolver(hostname, {ttl: false});

		const validIps = result.map(r => isRecordWithTtl(r) ? r.address : r).filter(r => !isIpPrivate(r));

		if (validIps.length === 0) {
			throw new Error(`ENODATA ${hostname}`);
		}

		recordOnBenchmark({type: 'http_dns_lookup', action: 'end', id: bId});
		return [validIps[0]!, options.family];
	} catch (error: unknown) {
		recordOnBenchmark({type: 'http_dns_lookup', action: 'end', id: bId});
		throw error as ErrnoException;
	}
};
