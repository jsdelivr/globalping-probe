import { isIP } from 'node:net';
import { cachedDnsLookupOne, type IpFamily, type LookupOptions, type RecordOptions } from '../lib/dns.js';
import { getErrorCode } from '../lib/error-code.js';
import { InternalError } from '../lib/internal-error.js';
import { isIpPrivate, normalizeIp } from '../lib/ip.js';
import { MEASUREMENT_DNS_RESOLUTION_TIMEOUT_MESSAGE } from './timeout.js';

export type CommandTargetLookup = {
	(hostname: string, options: LookupOptions): Promise<string>;
	(hostname: string, options: RecordOptions): Promise<string | undefined>;
};

export type ResolvedCommandTarget = {
	address: string;
	hostname: string;
};

export const resolveCommandTarget = async (
	target: string,
	family: IpFamily,
	signal: AbortSignal,
	lookup: CommandTargetLookup = cachedDnsLookupOne,
): Promise<ResolvedCommandTarget> => {
	const targetIsIp = isIP(target) !== 0;

	if (targetIsIp && isIpPrivate(target)) {
		throw new InternalError('Private IP ranges are not allowed.', true, 'target');
	}

	if (!targetIsIp) {
		try {
			const address = normalizeIp(await lookup(target, { family, signal }));
			return { address, hostname: target };
		} catch (error: unknown) {
			if (signal.aborted || getErrorCode(error) === 'ETIMEOUT') {
				throw new InternalError(MEASUREMENT_DNS_RESOLUTION_TIMEOUT_MESSAGE, true, 'resolver');
			}

			throw error;
		}
	}

	const address = normalizeIp(target);
	let hostname = address;

	try {
		hostname = await lookup(address, { rrtype: 'PTR', signal }) ?? hostname;
	} catch {
		// Reverse DNS only enriches output and never changes measurement attribution.
	}

	return { address, hostname };
};
