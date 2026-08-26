import { expect } from 'chai';
import { ipEquals, isIpPrivate, normalizeIp } from '../../../src/lib/ip.js';

describe('ip normalization', () => {
	it('should use compact notation without changing the address family', () => {
		expect(normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001')).to.equal('2001:db8::1');
		expect(normalizeIp('::ffff:7f00:1')).to.equal('::ffff:127.0.0.1');
	});

	it('should remove IPv6 scope IDs', () => {
		expect(normalizeIp('fe80::1%eth0')).to.equal('fe80::1');
	});
});

describe('ip equality', () => {
	it('should compare normalized IP addresses', () => {
		expect(ipEquals('1.1.1.1', '1.1.1.1')).to.be.true;
		expect(ipEquals('1.1.1.1', '1.1.1.2')).to.be.false;
		expect(ipEquals('2001:db8::1', '2001:0db8:0:0:0:0:0:1')).to.be.true;
	});

	it('should not match different address families or invalid values', () => {
		expect(ipEquals('::ffff:1.2.3.4', '1.2.3.4')).to.be.false;
		expect(ipEquals('invalid', 'invalid')).to.be.false;
	});
});

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
