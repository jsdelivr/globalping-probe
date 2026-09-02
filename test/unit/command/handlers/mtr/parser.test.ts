import { expect } from 'chai';
import { MtrParser } from '../../../../../src/command/handlers/mtr/parser.js';
import type { HopType } from '../../../../../src/command/handlers/mtr/types.js';
import { getCmdMock, getCmdMockResult } from '../../../../utils.js';

type MockResult = {
	result: {
		hops: HopType[];
		rawOutput: string;
	};
};

describe('mtr parser helper', () => {
	describe('rawParse', () => {
		it('normalizes alternate IPv6 representations without changing their address family', () => {
			const hops = MtrParser.rawParse('h 0 ::ffff:7f00:1', true);

			expect(hops[0]?.resolvedAddress).to.equal('::ffff:127.0.0.1');
		});

		it('keeps malformed responder addresses without throwing', () => {
			let hops: HopType[] = [];

			expect(() => {
				hops = MtrParser.rawParse('h 0 ::::', true);
			}).not.to.throw();

			expect(hops[0]?.resolvedAddress).to.equal('::::');
		});

		it('keeps IPv6 scope IDs only in formatted raw output', () => {
			const hops = MtrParser.rawParse([
				'x 0 33000',
				'h 0 192.168.0.1',
				'p 0 1000 33000',
				'x 1 33001',
				'h 1 fe80::1%eth0',
				'p 1 2000 33001',
			].join('\n'), true);

			expect(hops[1]?.resolvedAddress).to.equal('fe80::1');
			expect(MtrParser.outputBuilder(hops)).to.include('fe80::1%eth0 (fe80::1%eth0)');
		});

		it('keeps identical link-local addresses on different scopes as separate hops', () => {
			const hops = MtrParser.rawParse([
				'h 0 fe80::1%eth0',
				'h 1 fe80::1%eth1',
			].join('\n'), true);

			expect(hops.map(hop => hop.resolvedAddress)).to.deep.equal([ 'fe80::1', 'fe80::1' ]);
		});

		it('ignores native hostname records', () => {
			const hops = MtrParser.rawParse([
				'h 0 192.0.2.1',
				'd 0 router.example',
			].join('\n'), true);

			expect(hops[0]?.resolvedHostname).to.equal(undefined);
		});

		it('should transform raw inputs (progress)', () => {
			const testCase = 'mtr-success-raw-helper-progress';
			const expectedResult = (getCmdMockResult(testCase) as MockResult);

			const rawOutput = getCmdMock(testCase);

			const parsedOutput = MtrParser.rawParse(rawOutput, false);

			expect(parsedOutput).to.deep.equal(expectedResult);
		});

		it('should transform raw inputs (final - count all drops)', () => {
			const testCase = 'mtr-success-raw-helper-final';
			const expectedResult = (getCmdMockResult(testCase) as MockResult).result.hops;

			const rawOutput = getCmdMock(testCase);

			const parsedOutput = MtrParser.rawParse(rawOutput, true);

			expect(parsedOutput).to.deep.equal(expectedResult);
		});

		it('should remove an unresolved probe after the responding target', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 192.0.2.1',
				'p 0 1000 33000',
				'x 1 33001',
				'h 1 203.0.113.10',
				'p 1 12000 33001',
				'x 2 33002',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true, '203.0.113.10');

			expect(hops.map(hop => hop.resolvedAddress)).to.deep.equal([ '192.0.2.1', '203.0.113.10' ]);
		});

		it('should remove a duplicate target response after the first responding target', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 192.0.2.1',
				'p 0 1000 33000',
				'x 1 33001',
				'h 1 203.0.113.10',
				'p 1 12000 33001',
				'x 2 33002',
				'h 2 203.0.113.10',
				'p 2 13000 33002',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true, '203.0.113.10');

			expect(hops.map(hop => hop.resolvedAddress)).to.deep.equal([ '192.0.2.1', '203.0.113.10' ]);
		});

		it('should match equivalent IPv6 target representations', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 2001:db8::1',
				'p 0 1000 33000',
				'x 1 33001',
				'h 1 2001:db8::2',
				'p 1 12000 33001',
				'x 2 33002',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true, '2001:0db8:0000:0000:0000:0000:0000:0002');

			expect(hops.map(hop => hop.resolvedAddress)).to.deep.equal([ '2001:db8::1', '2001:db8::2' ]);
		});

		it('should not truncate after a target address without a received timing', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 203.0.113.10',
				'x 1 33001',
				'h 1 192.0.2.1',
				'p 1 12000 33001',
				'x 2 33002',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true, '203.0.113.10');

			expect(hops.map(hop => hop.resolvedAddress)).to.deep.equal([ '203.0.113.10', '192.0.2.1', undefined ]);
		});
	});

	describe('outputBuilder', () => {
		it('should transform obj into MTR-styled response', () => {
			const testCase = 'mtr-success-raw-helper-final';
			const data = (getCmdMockResult(testCase) as MockResult).result;
			const output = MtrParser.outputBuilder(data.hops);

			expect(output).to.deep.equal(data.rawOutput);
		});

		it('should align statistic columns when a hostname falls back to its address', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 10.239.107.1',
				'p 0 200 33000',
				'x 1 33001',
				'h 1 185.1.206.113',
				'p 1 2200 33001',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true);
			hops[1]!.asn = [ 212_271 ];
			const lines = MtrParser.outputBuilder(hops).trimEnd().split('\n');

			expect(new Set(lines.map(line => line.indexOf('%'))).size).to.equal(1);
		});

		it('should align statistic columns when ASNs are unknown', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 192.168.100.1',
				'p 0 5700 33000',
				'x 1 33001',
				'h 1 89.24.86.5',
				'p 1 4100 33001',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, false);
			const lines = MtrParser.outputBuilder(hops).trimEnd().split('\n');

			expect(new Set(lines.map(line => line.indexOf('%'))).size).to.equal(1);
		});

		it('should size the host column from complete rendered host values', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 10.0.0.1',
				'p 0 200 33000',
				'x 1 33001',
				'h 1 2001:db8::1234',
				'p 1 2200 33001',
				'x 2 33002',
				'h 2 1.1.1.1',
				'p 2 2300 33002',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true);
			hops[2]!.resolvedHostname = 'long-hostname.example';

			for (const hop of hops) {
				hop.asn = [ 123 ];
			}

			const output = MtrParser.outputBuilder(hops);

			expect(output).to.contain('long-hostname.example (1.1.1.1)    0.0%');
		});

		it('should trim all but one trailing empty hops', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 192.168.0.1',
				'p 0 1000 33000',
				'x 1 33001',
				'x 2 33002',
				'x 3 33003',
				'x 4 33004',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true);

			expect(hops.map(hop => hop.resolvedAddress)).to.deep.equal([ '192.168.0.1', undefined ]);

			expect(MtrParser.outputBuilder(hops)).to.equal([
				'Host                              Loss% Drop Rcv Avg  StDev  Javg ',
				'1. AS??? _gateway (192.168.0.1)    0.0%    0   1 1.0    0.0   1.0',
				'2. AS??? (waiting for reply)    ',
				'',
			].join('\n'));
		});

		it('should keep intermediate empty hops while trimming the trailing ones', () => {
			const rawOutput = [
				'x 0 33000',
				'h 0 192.168.0.1',
				'p 0 1000 33000',
				'x 1 33001',
				'x 2 33002',
				'h 2 62.252.67.181',
				'p 2 10000 33002',
				'x 3 33003',
				'x 4 33004',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true);

			expect(hops.map(hop => hop.resolvedAddress)).to.deep.equal([ '192.168.0.1', undefined, '62.252.67.181', undefined ]);

			expect(MtrParser.outputBuilder(hops)).to.equal([
				'Host                                     Loss% Drop Rcv Avg  StDev  Javg ',
				'1. AS??? _gateway (192.168.0.1)           0.0%    0   1 1.0    0.0   1.0',
				'2. AS??? (waiting for reply)           ',
				'3. AS??? 62.252.67.181 (62.252.67.181)    0.0%    0   1 10.0    0.0  10.0',
				'4. AS??? (waiting for reply)           ',
				'',
			].join('\n'));
		});

		it('should keep a single empty hop when no hop responded', () => {
			const rawOutput = [
				'x 0 33000',
				'x 1 33001',
				'x 2 33002',
			].join('\n');

			const hops = MtrParser.rawParse(rawOutput, true);

			expect(hops.map(hop => hop.resolvedAddress)).to.deep.equal([ undefined ]);

			expect(MtrParser.outputBuilder(hops)).to.equal([
				'Host                           Loss% Drop Rcv Avg  StDev  Javg ',
				'1. AS??? (waiting for reply) ',
				'',
			].join('\n'));
		});
	});
});
