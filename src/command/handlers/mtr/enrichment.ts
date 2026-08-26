import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
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
			const asnAddress = ipaddr.process(address);
			let asnHostname: string;

			if (asnAddress.kind() === 'ipv4') {
				asnHostname = `${asnAddress.toByteArray().reverse().join('.')}.origin.asn.cymru.com`;
			} else {
				const reversedNibbles = asnAddress.toByteArray()
					.flatMap(byte => byte.toString(16).padStart(2, '0').split(''))
					.reverse()
					.join('.');
				asnHostname = `${reversedNibbles}.origin6.asn.cymru.com`;
			}

			const record = await lookup(asnHostname, {
				rrtype: 'TXT',
				signal,
			});

			const asns = record?.split('|')[0]?.trim().split(/\s+/)
				.filter(value => /^\d+$/.test(value))
				.map(Number)
				.filter(value => Number.isInteger(value) && value > 0) ?? [];

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

			if (isIP(address) === 0 || isIpPrivate(address)) {
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
