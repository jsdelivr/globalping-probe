import {expect} from 'chai';
import {
	TraceDigParser,
	DnsParseResponse,
} from '../../../../../src/command/handlers/dig/trace.js';
import {getCmdMock} from '../../../../utils.js';

describe('dig trace helper', () => {
	describe('parse', () => {
		it('should succeed', () => {
			const rawOutput = getCmdMock('dig/trace.success');
			const parsedOutput = TraceDigParser.parse(rawOutput);

			expect(parsedOutput).to.not.be.instanceof(Error);
			expect((parsedOutput as DnsParseResponse).result.length).to.equal(4);
		});
	});
});
