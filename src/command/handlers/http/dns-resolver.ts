import {Resolver, RecordWithTtl} from 'node:dns';
import isIpPrivate from 'private-ip';

type IpFamily = 4 | 6;
type Options = {
	family: IpFamily;
};
type ErrnoException = NodeJS.ErrnoException;
export type ResolverCallbackType = (
// eslint-disable-next-line @typescript-eslint/ban-types
	error: Error | null,
	result: string[] | RecordWithTtl[],
) => void;
export type ResolverType = (hostname: string, options: {ttl: boolean}, cb: ResolverCallbackType) => void;

const isRecordWithTtl = (record: unknown): record is RecordWithTtl => Boolean((record as RecordWithTtl).ttl);

export const buildResolver = (resolverAddr: string | undefined, family: IpFamily): ResolverType => {
	const resolver = new Resolver();

	if (resolverAddr) {
		resolver.setServers([resolverAddr]);
	}

	const resolve = family === 6 ? resolver.resolve6.bind(resolver) : resolver.resolve4.bind(resolver);

	return resolve;
};

export const dnsLookup = (resolverAddr: string | undefined, resolverFn?: ResolverType): never => ((
	hostname: string,
	options: Options,
	callback: (
	// eslint-disable-next-line @typescript-eslint/ban-types
		error: ErrnoException | null,
		address: string | undefined,
		family: IpFamily
	) => void,
): void => {
	const resolver = resolverFn ?? buildResolver(resolverAddr, options.family);
	resolver(hostname, {ttl: false}, (error, result) => {
		if (error) {
			callback(error, undefined, 4 as IpFamily);
			return;
		}

		const validIps = result.map(r => isRecordWithTtl(r) ? r.address : r).filter(r => !isIpPrivate(r));

		if (validIps.length === 0) {
			callback(new Error(`ENODATA ${hostname}`), undefined, 4 as IpFamily);
			return;
		}

		callback(error, validIps[0], 4 as IpFamily);
	});
}) as never;
