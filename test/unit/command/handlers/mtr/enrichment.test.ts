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

		enrichment.add(hops);
		await enrichment.wait();

		expect(enrichment.apply(hops)[0]!.asn).to.deep.equal([ 24_940 ]);
	});

	it('should not enrich invalid addresses', async () => {
		const lookup = sinon.stub().resolves(undefined);
		const enrichment = new MtrHopEnrichment(lookup as CommandTargetLookup, { address: '1.1.1.1', hostname: '1.1.1.1' }, new AbortController().signal);

		enrichment.add([{ resolvedAddress: 'invalid', asn: [] }] as HopType[]);
		await enrichment.wait();

		expect(lookup.notCalled).to.be.true;
	});
});
