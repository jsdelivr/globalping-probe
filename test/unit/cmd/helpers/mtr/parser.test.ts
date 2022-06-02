import {expect} from 'chai';
import {MtrParser} from '../../../../../src/command/handlers/mtr/parser.js';
import type {HopType} from '../../../../../src/command/handlers/mtr/types.js';
import {getCmdMock, getCmdMockResult} from '../../../../utils.js';

type MockResult = {
	result: {
		hops: HopType[];
	};
};

describe('mtr parser helper', () => {
	describe('hopsParse', () => {
		it('should transform raw inputs (progress)', () => {
			const testCase = 'mtr-success-raw-helper-progress';
			const expectedResult = (getCmdMockResult(testCase) as MockResult).result.hops;

			const rawOutput = getCmdMock(testCase);

			const parsedOutput = MtrParser.hopsParse([], rawOutput, false);

			expect(parsedOutput).to.deep.equal(expectedResult);
		});

		it('should transform raw inputs (final - count all drops)', () => {
			const testCase = 'mtr-success-raw-helper-final';
			const expectedResult = (getCmdMockResult(testCase) as MockResult).result.hops;

			const rawOutput = getCmdMock(testCase);

			const parsedOutput = MtrParser.hopsParse([], rawOutput, true);

			expect(parsedOutput).to.deep.equal(expectedResult);
		});
	});
});
