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
