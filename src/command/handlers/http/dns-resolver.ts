import dns from 'node:dns';
import isIpPrivate from 'private-ip';

type IpFamily = 4 | 6;
type ErrnoException = NodeJS.ErrnoException;

export const dnsLookup = ((
	hostname: string,
	family: IpFamily,
	callback: (
	// eslint-disable-next-line @typescript-eslint/ban-types
		error: ErrnoException | null,
		address: string,
		family: IpFamily
	) => void,
): void => {
	dns.lookup(hostname, {family}, (
		// eslint-disable-next-line @typescript-eslint/ban-types
		error: ErrnoException | null,
		result: string,
		family_: number,
	) => {
		if (error) {
			callback(error, result, family_ as IpFamily);
			return;
		}

		const isPrivate = isIpPrivate(result);
		if (isPrivate) {
			callback(new Error('Private IP ranges are not allowed'), result, family_ as IpFamily);
			return;
		}

		callback(error, result, family_ as IpFamily);
	});
}) as never;
