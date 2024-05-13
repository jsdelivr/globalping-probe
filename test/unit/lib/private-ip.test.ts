import { expect } from 'chai';
import { isIpPrivate } from '../../../src/lib/private-ip.js';

describe('private ip validator', async () => {
	it('should pass ipv4', () => {
		const input = '1.1.1.1';
		const result: boolean = isIpPrivate(input);

		expect(result).to.be.false;
	});

	it('should pass ipv6', () => {
		const input = '2001:41f0:4060::';
		const result: boolean = isIpPrivate(input);

		expect(result).to.be.false;
	});

	it('should fail (private ipv4)', () => {
		const input = '192.168.0.101';
		const result: boolean = isIpPrivate(input);

		expect(result).to.be.true;
	});

	it('should fail (private ipv6)', () => {
		const input = '64:ff9b:1::1a2b:3c4d';
		const result: boolean = isIpPrivate(input);

		expect(result).to.be.true;
	});
});
