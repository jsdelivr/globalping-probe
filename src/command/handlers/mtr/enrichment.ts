import { isIP } from 'node:net';
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
			let asnHostname: string;

			if (isIP(address) === 4) {
				asnHostname = `${address.split('.').reverse().join('.')}.origin.asn.cymru.com`;
			} else {
				let normalizedAddress = address.toLowerCase();
				const lastGroup = normalizedAddress.slice(normalizedAddress.lastIndexOf(':') + 1);

				if (lastGroup.includes('.')) {
					const [ first = 0, second = 0, third = 0, fourth = 0 ] = lastGroup.split('.').map(Number);
					const ipv4Groups = [ first * 256 + second, third * 256 + fourth ].map(group => group.toString(16));
					normalizedAddress = `${normalizedAddress.slice(0, normalizedAddress.lastIndexOf(':') + 1)}${ipv4Groups.join(':')}`;
				}

				const [ head = '', tail = '' ] = normalizedAddress.split('::');
				const headGroups = head ? head.split(':') : [];
				const tailGroups = tail ? tail.split(':') : [];
				const omittedGroups = Array.from({ length: 8 - headGroups.length - tailGroups.length }, () => '0');
				const groups = [ ...headGroups, ...omittedGroups, ...tailGroups ]
					.map(group => group.padStart(4, '0'));
				const isIpv4Mapped = groups.slice(0, 5).every(group => group === '0000') && groups[5] === 'ffff';

				if (isIpv4Mapped) {
					const ipv4Hex = groups.slice(6).join('');
					const ipv4Address = Array.from({ length: 4 }, (_, index) => Number.parseInt(ipv4Hex.slice(index * 2, index * 2 + 2), 16));
					asnHostname = `${ipv4Address.reverse().join('.')}.origin.asn.cymru.com`;
				} else {
					const reversedNibbles = groups.join('').split('').reverse().join('.');
					asnHostname = `${reversedNibbles}.origin6.asn.cymru.com`;
				}
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
