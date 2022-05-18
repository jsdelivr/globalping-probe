import {Resolver, RecordWithTtl} from 'node:dns';
import isIpPrivate from 'private-ip';

type IpFamily = 4 | 6;
type Options = {
	family: IpFamily;
};
type ErrnoException = NodeJS.ErrnoException;

const isRecordWithTtl = (record: unknown): record is RecordWithTtl => Boolean((record as RecordWithTtl).ttl);

export const dnsLookup = (resolverAddr: string | undefined) => ((
	hostname: string,
	_options: Options,
	callback: (
	// eslint-disable-next-line @typescript-eslint/ban-types
		error: ErrnoException | null,
		address: string | undefined,
		family: IpFamily
	) => void,
): void => {
	const resolver = new Resolver();

	if (resolverAddr) {
		resolver.setServers([resolverAddr]);
	}

	resolver.resolve4(hostname, {ttl: false}, (
		// eslint-disable-next-line @typescript-eslint/ban-types
		error: Error | null,
		result: string[] | RecordWithTtl[],
	) => {
		if (error) {
			callback(error, undefined, 4 as IpFamily);
			return;
		}

		const validIps = result.map(r => isRecordWithTtl(r) ? r.address : r).filter(record => !isIpPrivate(record));

		if (validIps.length === 0) {
			callback(new Error(`ENODATA ${hostname}`), undefined, 4 as IpFamily);
			return;
		}

		callback(error, validIps[0], 4 as IpFamily);
	});
}) as never;
