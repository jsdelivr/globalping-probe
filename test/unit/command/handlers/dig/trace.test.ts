import { expect } from 'chai';
import {
	TraceDigParser,
	type DnsParseResponse,
} from '../../../../../src/command/handlers/dig/trace.js';
import { getCmdMock } from '../../../../utils.js';

describe('dig trace helper', () => {
	describe('parse', () => {
		it('should succeed', () => {
			const rawOutput = getCmdMock('dig/trace.success');
			const parsedOutput = TraceDigParser.parse(rawOutput);

			expect(parsedOutput).to.not.be.instanceof(Error);
			expect((parsedOutput as DnsParseResponse).hops.length).to.equal(4);
		});

		it('should parse the status of every hop', () => {
			const rawOutput = getCmdMock('dig/trace.refused');
			const parsedOutput = TraceDigParser.parse(rawOutput) as DnsParseResponse;

			expect(parsedOutput.hops.map(hop => [ hop.resolver, hop.statusCodeName, hop.statusCode, hop.answers.length ])).to.deep.equal([
				[ '1.1.1.1', 'NOERROR', 0, 14 ],
				[ 'd.root-servers.net', 'NOERROR', 0, 8 ],
				[ 'v2n0.nic.tools', 'NOERROR', 0, 4 ],
				[ 'hope.ns.cloudflare.com', 'NOERROR', 0, 3 ],
				[ 'dnscheck.tools', 'REFUSED', 5, 0 ],
			]);
		});

		it('should skip comment lines', () => {
			const rawOutput = getCmdMock('dig/trace.server-found');
			const parsedOutput = TraceDigParser.parse(rawOutput) as DnsParseResponse;

			expect(parsedOutput.hops.map(hop => hop.answers)).to.deep.equal([
				[{ name: '.', type: 'NS', ttl: 60, class: 'IN', value: 'localhost.' }],
				[{ name: 'trace.compat.test.', type: 'A', ttl: 60, class: 'IN', value: '127.0.0.1' }],
			]);
		});
	});
});
