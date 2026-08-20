import { expect } from 'chai';
import { isIpPrivate } from '../../../src/lib/ip.js';

describe('private ip validator', async () => {
	it('should allow private addresses only when both test gates are active', () => {
		const environmentCases = [
			{ nodeEnv: 'production', allowPrivateTargets: '1', expected: true },
			{ nodeEnv: 'test', allowPrivateTargets: undefined, expected: true },
			{ nodeEnv: 'test', allowPrivateTargets: '1', expected: false },
		];

		for (const { nodeEnv, allowPrivateTargets, expected } of environmentCases) {
			const originalNodeEnv = process.env['NODE_ENV'];
			const originalAllowPrivateTargets = process.env['GP_TEST_ALLOW_PRIVATE_TARGETS'];

			try {
				process.env['NODE_ENV'] = nodeEnv;

				if (allowPrivateTargets === undefined) {
					delete process.env['GP_TEST_ALLOW_PRIVATE_TARGETS'];
				} else {
					process.env['GP_TEST_ALLOW_PRIVATE_TARGETS'] = allowPrivateTargets;
				}

				expect(isIpPrivate('127.0.0.1')).to.equal(expected);
			} finally {
				if (originalNodeEnv === undefined) {
					delete process.env['NODE_ENV'];
				} else {
					process.env['NODE_ENV'] = originalNodeEnv;
				}

				if (originalAllowPrivateTargets === undefined) {
					delete process.env['GP_TEST_ALLOW_PRIVATE_TARGETS'];
				} else {
					process.env['GP_TEST_ALLOW_PRIVATE_TARGETS'] = originalAllowPrivateTargets;
				}
			}
		}
	});

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
