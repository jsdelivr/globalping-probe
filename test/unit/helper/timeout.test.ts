import { expect } from 'chai';
import {
	getLastPacketTime,
	getPacketInterval,
	getProcessTimeout,
} from '../../../src/helper/timeout.js';

describe('command timeout helpers', () => {
	it('should keep the configured packet interval when it fits the timeout', () => {
		expect(getPacketInterval(3, 5, 0.5, 0.25)).to.equal(0.5);
		expect(getPacketInterval(16, 11, 0.5, 0.25)).to.equal(0.5);
	});

	it('should shorten the packet interval when it exceeds the timeout', () => {
		expect(getPacketInterval(16, 5, 0.5, 0.2)).to.equal(0.2);
	});

	it('should calculate the time of the last packet', () => {
		expect(getLastPacketTime(16, 0.25)).to.equal(3.75);
	});

	it('should allow two extra seconds for the process timeout', () => {
		expect(getProcessTimeout(5, 2)).to.equal(7000);
	});

	it('should use the configured process grace by default', () => {
		expect(getProcessTimeout(5)).to.equal(7000);
	});
});
