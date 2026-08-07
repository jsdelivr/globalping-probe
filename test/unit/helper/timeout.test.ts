import { expect } from 'chai';
import {
	getMtrBudget,
	getPingBudget,
	getProcessTimeout,
	getTracerouteBudget,
} from '../../../src/helper/timeout.js';

describe('command timeout helpers', () => {
	describe('ping budget', () => {
		for (const { packets, timeout, expected } of [
			{ packets: 3, timeout: 5, expected: { interval: 0.2, responseTimeout: 2.6, dnsHeadroom: 2 } },
			{ packets: 3, timeout: 6, expected: { interval: 0.26, responseTimeout: 3.46, dnsHeadroom: 2 } },
			{ packets: 3, timeout: 8, expected: { interval: 0.5, responseTimeout: 5, dnsHeadroom: 2 } },
			{ packets: 3, timeout: 10, expected: { interval: 0.5, responseTimeout: 5, dnsHeadroom: 4 } },
			{ packets: 16, timeout: 5, expected: { interval: 0.2, responseTimeout: 1, dnsHeadroom: 1 } },
			{ packets: 16, timeout: 10, expected: { interval: 0.29, responseTimeout: 3.61, dnsHeadroom: 2 } },
			{ packets: 16, timeout: 16, expected: { interval: 0.5, responseTimeout: 5, dnsHeadroom: 3.5 } },
		]) {
			it(`should allocate ${packets} packets within ${timeout} seconds`, () => {
				expect(getPingBudget(packets, timeout)).to.deep.equal(expected);
			});
		}

		it('should keep every supported packet and timeout combination within budget', () => {
			for (let timeout = 5; timeout <= 30; timeout++) {
				for (let packets = 1; packets <= 16; packets++) {
					const { interval, responseTimeout, dnsHeadroom } = getPingBudget(packets, timeout);

					expect(interval).to.be.within(0.2, 0.5);
					expect(responseTimeout).to.be.within(1, 5);
					expect(dnsHeadroom).to.be.at.least(1);
					expect((packets - 1) * interval + responseTimeout + dnsHeadroom).to.be.at.most(timeout);
				}
			}
		});

		it('should preserve an explicit interval when the minimum DNS and response budgets still fit', () => {
			expect(getPingBudget(6, 10, 1)).to.deep.equal({ interval: 1, responseTimeout: 3, dnsHeadroom: 2 });
		});

		it('should fall back to dynamic allocation when an explicit interval does not fit', () => {
			expect(getPingBudget(16, 5, 1)).to.deep.equal({ interval: 0.2, responseTimeout: 1, dnsHeadroom: 1 });
		});
	});

	describe('traceroute budget', () => {
		for (const { timeout, probeWaves, expected } of [
			{ timeout: 5, probeWaves: 2, expected: { wait: 1.5 } },
			{ timeout: 5, probeWaves: 4, expected: { wait: 0.75 } },
			{ timeout: 10, probeWaves: 2, expected: { wait: 3 } },
			{ timeout: 10, probeWaves: 3, expected: { wait: 2 } },
			{ timeout: 16, probeWaves: 2, expected: { wait: 4.8 } },
			{ timeout: 17, probeWaves: 2, expected: { wait: 5 } },
			{ timeout: 30, probeWaves: 2, expected: { wait: 5 } },
		]) {
			it(`should allocate ${probeWaves} probe waves within ${timeout} seconds`, () => {
				expect(getTracerouteBudget(timeout, probeWaves)).to.deep.equal(expected);
			});
		}

		it('should keep two probe waves within the supported timeout range', () => {
			for (let timeout = 5; timeout <= 30; timeout++) {
				const { wait } = getTracerouteBudget(timeout, 2);

				expect(wait).to.be.at.most(5);
				expect(2 * wait).to.be.at.most(10);
				expect(2 * wait).to.be.at.most(timeout * 0.6 + 1e-9);
			}
		});
	});

	describe('mtr budget', () => {
		for (const { packets, remaining, expected } of [
			{ packets: 3, remaining: 4.5, expected: { interval: 0.5, grace: 3, nativeTimeout: 3 } },
			{ packets: 16, remaining: 11, expected: { interval: 0.5, grace: 3, nativeTimeout: 3 } },
			{ packets: 16, remaining: 6.8, expected: { interval: 0.23, grace: 3, nativeTimeout: 3 } },
			{ packets: 16, remaining: 4.2, expected: { interval: 0.2, grace: 1, nativeTimeout: 1 } },
		]) {
			it(`should allocate ${packets} packets within ${remaining} seconds`, () => {
				expect(getMtrBudget(packets, remaining)).to.deep.equal(expected);
			});
		}

		it('should keep viable fractional budgets within native limits', () => {
			for (let packets = 1; packets <= 16; packets++) {
				const minimumRuntime = packets * 0.2 + 1;

				for (const remaining of [ minimumRuntime, minimumRuntime + 0.37, minimumRuntime + 2.91, 30 ]) {
					const { interval, grace, nativeTimeout } = getMtrBudget(packets, remaining);

					expect(interval).to.be.within(0.2, 0.5);
					expect(grace).to.be.oneOf([ 1, 2, 3 ]);
					expect(Number.isInteger(nativeTimeout)).to.equal(true);
					expect(nativeTimeout).to.be.at.least(1);
					expect(packets * interval + grace).to.be.at.most(remaining + 1e-9);
				}
			}
		});
	});

	it('should allow two extra seconds for the process timeout', () => {
		expect(getProcessTimeout(5, 2)).to.equal(7000);
	});

	it('should use the configured process grace by default', () => {
		expect(getProcessTimeout(5)).to.equal(7000);
	});
});
