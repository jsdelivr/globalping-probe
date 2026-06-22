import { expect } from 'chai';
import {
	getBackstopTimeout,
	MIN_MEASUREMENT_TIMEOUT,
	MAX_MEASUREMENT_TIMEOUT,
} from '../../../src/lib/measurement-timeout.js';

describe('measurement timeout', () => {
	describe('getBackstopTimeout', () => {
		it('falls back to the global commands.timeout (25s) when no timeout is provided', () => {
			expect(getBackstopTimeout(undefined)).to.equal(25_000);
		});

		it('uses the provided timeout, converting seconds to milliseconds', () => {
			expect(getBackstopTimeout(10)).to.equal(10_000);
		});

		it('adds the grace seconds on top of the provided timeout', () => {
			expect(getBackstopTimeout(10, 3)).to.equal(13_000);
		});

		it('ignores the grace when no timeout is provided', () => {
			expect(getBackstopTimeout(undefined, 3)).to.equal(25_000);
		});
	});

	describe('bounds', () => {
		it('exposes a valid min/max range', () => {
			expect(MIN_MEASUREMENT_TIMEOUT).to.be.at.least(1);
			expect(MIN_MEASUREMENT_TIMEOUT).to.be.lessThan(MAX_MEASUREMENT_TIMEOUT);
		});
	});
});
