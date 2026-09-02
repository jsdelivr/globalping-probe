import { expect } from 'chai';
import * as sinon from 'sinon';
import { MtrHopEnrichment } from '../../../../../src/command/handlers/mtr/enrichment.js';
import type { HopType } from '../../../../../src/command/handlers/mtr/types.js';
import type { CommandTargetLookup } from '../../../../../src/helper/resolve-command-target.js';

describe('mtr hop enrichment', () => {
	it('should resolve ASNs for IPv6 addresses', async () => {
		const address = '2a01:4f9:0:c001::1536';
		const asnHostname = '6.3.5.1.0.0.0.0.0.0.0.0.0.0.0.0.1.0.0.c.0.0.0.0.9.f.4.0.1.0.a.2.origin6.asn.cymru.com';
		const lookup = (async (hostname: string, options: { rrtype?: string }) => {
			return options.rrtype === 'TXT' && hostname === asnHostname
				? '24940 | example | example'
				: undefined;
		}) as CommandTargetLookup;
		const enrichment = new MtrHopEnrichment(lookup, { address, hostname: address }, new AbortController().signal);
		const hops = [{ resolvedAddress: address, asn: [] }] as HopType[];

		enrichment.add(address);
		await enrichment.wait();

		expect(enrichment.apply(hops)[0]!.asn).to.deep.equal([ 24_940 ]);
	});

	it('should use IPv4 ASN lookups for IPv4-mapped IPv6 addresses', async () => {
		const address = '::ffff:1.2.3.4';
		const asnHostname = '4.3.2.1.origin.asn.cymru.com';
		const lookup = (async (hostname: string, options: { rrtype?: string }) => {
			return options.rrtype === 'TXT' && hostname === asnHostname
				? '64500 | example | example'
				: undefined;
		}) as CommandTargetLookup;
		const enrichment = new MtrHopEnrichment(lookup, { address, hostname: address }, new AbortController().signal);
		const hops = [{ resolvedAddress: address, asn: [] }] as HopType[];

		enrichment.add(address);
		await enrichment.wait();

		expect(enrichment.apply(hops)[0]!.asn).to.deep.equal([ 64_500 ]);
	});

	it('should ignore invalid ASN values', async () => {
		const lookup = (async (hostname: string, options: { rrtype?: string }) => {
			if (options.rrtype !== 'TXT') {
				return undefined;
			}

			if (hostname === '4.3.2.1.origin.asn.cymru.com') {
				return ' | example | example';
			}

			if (hostname === '8.7.6.5.origin.asn.cymru.com') {
				return 'invalid 0 -1 1.5 64500 | example | example';
			}

			return undefined;
		}) as CommandTargetLookup;
		const enrichment = new MtrHopEnrichment(lookup, { address: '9.9.9.9', hostname: '9.9.9.9' }, new AbortController().signal);
		const hops = [
			{ resolvedAddress: '1.2.3.4', asn: [] },
			{ resolvedAddress: '5.6.7.8', asn: [] },
		] as HopType[];

		enrichment.add('1.2.3.4');
		enrichment.add('5.6.7.8');
		await enrichment.wait();

		const enrichedHops = enrichment.apply(hops);
		expect(enrichedHops[0]!.asn).to.deep.equal([]);
		expect(enrichedHops[1]!.asn).to.deep.equal([ 64_500 ]);
	});

	it('should not enrich invalid addresses', async () => {
		const lookup = sinon.stub().resolves(undefined);
		const enrichment = new MtrHopEnrichment(lookup as CommandTargetLookup, { address: '1.1.1.1', hostname: '1.1.1.1' }, new AbortController().signal);

		enrichment.add('invalid');
		await enrichment.wait();

		expect(lookup.notCalled).to.be.true;
	});
});
