import dns, {RecordWithTtl} from 'node:dns';
import isIpPrivate from 'private-ip';

type IpFamily = 4 | 6;
type Options = {
	family: IpFamily;
};
type ErrnoException = NodeJS.ErrnoException;
export type ResolverOptionsType = {ttl: boolean};
export type ResolverType = (hostname: string, options: ResolverOptionsType) => Promise<string[]>;

const isRecordWithTtl = (record: unknown): record is RecordWithTtl => Boolean((record as RecordWithTtl).ttl);

export const buildResolver = (resolverAddr: string | undefined, family: IpFamily): ResolverType => {
	const resolver = new dns.promises.Resolver();

	if (resolverAddr) {
		resolver.setServers([resolverAddr]);
	}

	const resolve = family === 6 ? resolver.resolve6.bind(resolver) : resolver.resolve4.bind(resolver);

	return resolve;
};

export const dnsLookup = (resolverAddr: string | undefined, resolverFn?: ResolverType) => async (
	hostname: string,
	options: Options,
): Promise<Error | ErrnoException | [string, number]> => {
	const resolver = resolverFn ?? buildResolver(resolverAddr, options.family);

	try {
		const result = await resolver(hostname, {ttl: false});

		const validIps = result.map(r => isRecordWithTtl(r) ? r.address : r).filter(r => !isIpPrivate(r));

		if (validIps.length === 0) {
			throw new Error(`ENODATA ${hostname}`);
		}

		return [validIps[0]!, options.family];
	} catch (error: unknown) {
		throw error as ErrnoException;
	}
};

export const callbackify = (
	fn: (..._args: never[]) => Promise<any>,
) => (async (...args: unknown[]) => {
	const cb = args[args.length - 1] as (error: Error | undefined, result?: string | undefined, family?: number | undefined) => void;
	const pArgs = args.slice(0, -1) as never[];

	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const result = await fn(...pArgs);

		if (Array.isArray(result)) {
			cb(undefined, ...result);
			return;
		}

		cb(undefined, result);
	} catch (error: unknown) {
		cb(error as Error);
	}
}) as (...args: unknown[]) => never;
