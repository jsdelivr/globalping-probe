import { expect } from 'chai';
import { getErrorCode } from '../../../src/lib/error-code.js';

describe('error code helper', () => {
	it('should extract a direct string code', () => {
		expect(getErrorCode(Object.assign(new Error('x'), { code: 'EMFILE' }))).to.equal('EMFILE');
	});

	it('should extract a string code from the error cause', () => {
		expect(getErrorCode(new Error('x', {
			cause: Object.assign(new Error('cause'), { code: 'ENOBUFS' }),
		}))).to.equal('ENOBUFS');
	});

	for (const error of [
		Object.assign(new Error('x'), { code: 123 }),
		new Error('x'),
		null,
	]) {
		it('should ignore errors without a string code', () => {
			expect(getErrorCode(error)).to.equal(undefined);
		});
	}
});
