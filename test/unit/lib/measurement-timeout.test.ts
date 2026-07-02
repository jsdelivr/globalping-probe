import { expect } from 'chai';
import config from 'config';
import {
	getBackstopTimeout,
	MIN_MEASUREMENT_TIMEOUT,
	MAX_MEASUREMENT_TIMEOUT,
} from '../../../src/lib/measurement-timeout.js';

describe('measurement timeout', () => {
	const defaultTimeoutMs = config.get<number>('commands.timeout') * 1000;

	describe('getBackstopTimeout', () => {
		it('falls back to the global commands.timeout when no timeout is provided', () => {
			expect(getBackstopTimeout(undefined)).to.equal(defaultTimeoutMs);
		});

		it('uses the provided timeout, converting seconds to milliseconds', () => {
			expect(getBackstopTimeout(10)).to.equal(10_000);
		});

		it('adds the grace seconds on top of the provided timeout', () => {
			expect(getBackstopTimeout(10, 3)).to.equal(13_000);
		});

		it('ignores the grace when no timeout is provided', () => {
			expect(getBackstopTimeout(undefined, 3)).to.equal(defaultTimeoutMs);
		});
	});

	describe('bounds', () => {
		it('exposes a valid min/max range', () => {
			expect(MIN_MEASUREMENT_TIMEOUT).to.be.at.least(1);
			expect(MIN_MEASUREMENT_TIMEOUT).to.be.lessThan(MAX_MEASUREMENT_TIMEOUT);
		});
	});
});
