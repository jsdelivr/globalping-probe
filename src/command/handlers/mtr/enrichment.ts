import { AsyncLookupMap } from '../../../helper/async-lookup-map.js';
import type { CommandTargetLookup, ResolvedCommandTarget } from '../../../helper/resolve-command-target.js';
import { isIpPrivate } from '../../../lib/ip.js';
import type { HopType } from './types.js';

export class MtrHopEnrichment {
	private readonly hostnames: AsyncLookupMap<string, string>;
	private readonly asns: AsyncLookupMap<string, number[]>;

	constructor (lookup: CommandTargetLookup, target: ResolvedCommandTarget, signal: AbortSignal) {
		this.hostnames = new AsyncLookupMap(address => lookup(address, {
			rrtype: 'PTR',
			signal,
		}));

		this.asns = new AsyncLookupMap(async (address) => {
			const reversedAddr = address.split('.').reverse().join('.');
			const record = await lookup(`${reversedAddr}.origin.asn.cymru.com`, {
				rrtype: 'TXT',
				signal,
			});
			const asns = record?.split('|')[0]?.trim().split(/\s+/).map(Number).filter(Number.isFinite) ?? [];

			return asns.length > 0 ? asns : undefined;
		});

		if (target.address !== target.hostname) {
			this.hostnames.set(target.address, target.hostname);
		}
	}

	add (hops: HopType[]): void {
		for (const hop of hops) {
			const address = hop.resolvedAddress;

			if (!address) {
				continue;
			}

			if (hop.resolvedHostname && hop.resolvedHostname !== address && !this.hostnames.get(address)) {
				this.hostnames.set(address, hop.resolvedHostname);
			}

			if (hop.asn.length > 0 && !this.asns.get(address)) {
				this.asns.set(address, hop.asn);
			}

			if (isIpPrivate(address)) {
				continue;
			}

			this.hostnames.add(address);
			this.asns.add(address);
		}
	}

	apply (hops: HopType[]): HopType[] {
		return hops.map((hop) => {
			const address = hop.resolvedAddress;

			if (!address) {
				return hop;
			}

			const hostname = this.hostnames.get(address) ?? hop.resolvedHostname;

			return {
				...hop,
				...(hostname && { resolvedHostname: hostname }),
				asn: this.asns.get(address) ?? hop.asn,
			};
		});
	}

	async wait (): Promise<void> {
		await Promise.all([ this.hostnames.wait(), this.asns.wait() ]);
	}
}
