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
	});

	describe('outputBuilder', () => {
		it('should transform obj into MTR-styled response', () => {
			const testCase = 'mtr-success-raw-helper-final';
			const data = (getCmdMockResult(testCase) as MockResult).result;
			const output = MtrParser.outputBuilder(data.hops);

			expect(output).to.deep.equal(data.rawOutput);
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
				'Host                    Loss% Drop Rcv Avg  StDev  Javg ',
				'1. AS??? _gateway (192.168.0.1)    0.0%    0   1 1.0    0.0   1.0',
				'2. AS??? (waiting for reply) ',
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
				'Host                      Loss% Drop Rcv Avg  StDev  Javg ',
				'1. AS??? _gateway (192.168.0.1)    0.0%    0   1 1.0    0.0   1.0',
				'2. AS??? (waiting for reply) ',
				'3. AS??? 62.252.67.181 (62.252.67.181)    0.0%    0   1 10.0    0.0  10.0',
				'4. AS??? (waiting for reply) ',
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
				'Host          Loss% Drop Rcv Avg  StDev  Javg ',
				'1. AS??? (waiting for reply) ',
				'',
			].join('\n'));
		});
	});
});
