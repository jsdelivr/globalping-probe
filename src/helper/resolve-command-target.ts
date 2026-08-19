import { isIP } from 'node:net';
import { cachedDnsLookupOne, type IpFamily, type LookupOptions, type RecordOptions } from '../lib/dns.js';
import { InternalError } from '../lib/internal-error.js';
import { isIpPrivate } from '../lib/ip.js';

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
			const address = await lookup(target, { family, signal });
			return { address, hostname: target };
		} catch (error: unknown) {
			if (signal.aborted) {
				throw new InternalError('The measurement command timed out.', true, 'resolver');
			}

			throw error;
		}
	}

	let hostname = target;

	try {
		hostname = await lookup(target, { rrtype: 'PTR', signal }) ?? hostname;
	} catch {
		// Reverse DNS only enriches output and never changes measurement attribution.
	}

	return { address: target, hostname };
};
