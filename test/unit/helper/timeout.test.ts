import { expect } from 'chai';
import * as sinon from 'sinon';
import {
	createMeasurementDeadline,
	getMtrBudget,
	getPingBudget,
	getProcessTimeout,
	getTracerouteBudget,
} from '../../../src/helper/timeout.js';

describe('command timeout helpers', () => {
	describe('measurement deadline', () => {
		it('should track the remaining measurement and process time', () => {
			const clock = sinon.useFakeTimers();

			try {
				const deadline = createMeasurementDeadline(10);

				expect(deadline.remainingMs()).to.equal(10_000);
				expect(deadline.processTimeout()).to.equal(12_000);

				clock.tick(3000);

				expect(deadline.remainingMs()).to.equal(7000);
				expect(deadline.processTimeout()).to.equal(9000);

				clock.tick(7000);

				expect(deadline.remainingMs()).to.equal(0);
				expect(deadline.processTimeout()).to.equal(2000);
			} finally {
				clock.restore();
			}
		});

		it('should create signals for a fixed interval and the remaining deadline', () => {
			const clock = sinon.useFakeTimers();
			const fixedSignal = new AbortController().signal;
			const deadlineSignal = new AbortController().signal;
			const timeout = sinon.stub(AbortSignal, 'timeout');
			timeout.onFirstCall().returns(fixedSignal);
			timeout.onSecondCall().returns(deadlineSignal);

			try {
				const deadline = createMeasurementDeadline(10);
				clock.tick(3000);

				expect(deadline.signalFor(4)).to.equal(fixedSignal);
				expect(deadline.signal()).to.equal(deadlineSignal);
				expect(timeout.firstCall.args).to.deep.equal([ 4000 ]);
				expect(timeout.secondCall.args).to.deep.equal([ 7000 ]);
			} finally {
				timeout.restore();
				clock.restore();
			}
		});
	});

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

		it('should preserve an explicit interval', () => {
			expect(getPingBudget(6, 10, 1)).to.deep.equal({ interval: 1, responseTimeout: 3, dnsHeadroom: 2 });
		});
	});

	describe('traceroute budget', () => {
		for (const { timeout, probeWaves, expected } of [
			{ timeout: 5, probeWaves: 2, expected: { wait: 1.5, dnsHeadroom: 2 } },
			{ timeout: 5, probeWaves: 4, expected: { wait: 0.75, dnsHeadroom: 2 } },
			{ timeout: 10, probeWaves: 2, expected: { wait: 3, dnsHeadroom: 4 } },
			{ timeout: 10, probeWaves: 3, expected: { wait: 2, dnsHeadroom: 4 } },
			{ timeout: 16, probeWaves: 2, expected: { wait: 4.8, dnsHeadroom: 6.4 } },
			{ timeout: 17, probeWaves: 2, expected: { wait: 5, dnsHeadroom: 7 } },
			{ timeout: 30, probeWaves: 2, expected: { wait: 5, dnsHeadroom: 20 } },
		]) {
			it(`should allocate ${probeWaves} probe waves within ${timeout} seconds`, () => {
				expect(getTracerouteBudget(timeout, probeWaves)).to.deep.equal(expected);
			});
		}

		it('should keep two probe waves within the supported timeout range', () => {
			for (let timeout = 5; timeout <= 30; timeout++) {
				const { wait, dnsHeadroom } = getTracerouteBudget(timeout, 2);

				expect(wait).to.be.at.most(5);
				expect(2 * wait).to.be.at.most(10);
				expect(2 * wait).to.be.at.most(timeout * 0.6 + 1e-9);
				expect(2 * wait + dnsHeadroom).to.be.at.most(timeout + 1e-9);
			}
		});
	});

	describe('mtr budget', () => {
		for (const { packets, timeout, expected } of [
			{ packets: 3, timeout: 5, expected: { interval: 0.2, grace: 2.4, nativeTimeout: 3, dnsHeadroom: 2 } },
			{ packets: 3, timeout: 10, expected: { interval: 0.5, grace: 4.5, nativeTimeout: 5, dnsHeadroom: 4 } },
			{ packets: 16, timeout: 5, expected: { interval: 0.2, grace: 0.8, nativeTimeout: 1, dnsHeadroom: 1 } },
			{ packets: 16, timeout: 10, expected: { interval: 0.33, grace: 2.67, nativeTimeout: 3, dnsHeadroom: 2.05 } },
			{ packets: 16, timeout: 16, expected: { interval: 0.5, grace: 4.5, nativeTimeout: 5, dnsHeadroom: 3.5 } },
		]) {
			it(`should allocate ${packets} packets within ${timeout} seconds`, () => {
				expect(getMtrBudget(packets, timeout)).to.deep.equal(expected);
			});
		}

		it('should keep every supported packet and timeout combination within budget', () => {
			for (let timeout = 5; timeout <= 30; timeout++) {
				for (let packets = 1; packets <= 16; packets++) {
					const { interval, grace, nativeTimeout, dnsHeadroom } = getMtrBudget(packets, timeout);

					expect(interval).to.be.within(0.2, 0.5);
					expect(grace).to.be.within(0.5, 5);
					expect(Number.isInteger(nativeTimeout)).to.equal(true);
					expect(nativeTimeout).to.be.at.least(1);
					expect(dnsHeadroom).to.be.at.least(1);
					expect(packets * interval + grace + dnsHeadroom).to.be.at.most(timeout + 1e-9);
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
