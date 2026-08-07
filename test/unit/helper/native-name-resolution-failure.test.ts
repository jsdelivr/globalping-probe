import { expect } from 'chai';
import { getNativeNameResolutionFailureSource } from '../../../src/helper/native-name-resolution-failure.js';

describe('native name resolution failure', () => {
	for (const message of [
		'Name or service not known',
		'No address associated with hostname',
		'Address family for hostname not supported',
		'unknown host',
	]) {
		it(`should classify "${message}" as target`, () => {
			expect(getNativeNameResolutionFailureSource(message)).to.equal('target');
			expect(getNativeNameResolutionFailureSource(message.toUpperCase())).to.equal('target');
		});
	}

	for (const message of [
		'Temporary failure in name resolution',
		'Non-recoverable failure in name resolution',
	]) {
		it(`should classify "${message}" as resolver`, () => {
			expect(getNativeNameResolutionFailureSource(message)).to.equal('resolver');
			expect(getNativeNameResolutionFailureSource(message.toUpperCase())).to.equal('resolver');
		});
	}

	it('should not classify an unknown native error', () => {
		expect(getNativeNameResolutionFailureSource('unexpected native error')).to.equal(undefined);
	});
});
