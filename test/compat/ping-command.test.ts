import { expect } from 'chai';
import { ipEquals } from '../../src/lib/ip.js';
import { PingCommand, type PingOptions } from '../../src/command/ping-command.js';
import { expectFiniteNumbers, loopbackTargets, runCommand } from './command-test-helpers.js';

describe('ping compatibility', () => {
	for (const { target, ipVersion } of loopbackTargets) {
		it(`runs ping against IPv${ipVersion} loopback`, async () => {
			const options: PingOptions = {
				type: 'ping',
				inProgressUpdates: false,
				target,
				packets: 1,
				protocol: 'ICMP',
				port: 80,
				ipVersion,
				timeout: 5,
			};
			const result = await runCommand(new PingCommand(), options);

			expect(result.status, result.rawOutput).to.equal('finished');
			expect(ipEquals(result.resolvedAddress, target)).to.equal(true);
			expect(result.timings).to.have.length(1);

			expect(result.stats).to.deep.include({
				total: 1,
				rcv: 1,
				drop: 0,
				loss: 0,
			});

			expect(result.stats.min).to.be.a('number');
			expect(result.stats.avg).to.be.a('number');
			expect(result.stats.max).to.be.a('number');
			expectFiniteNumbers(result);
		});
	}

	it('classifies a ping name-resolution failure', async () => {
		const options: PingOptions = {
			type: 'ping',
			inProgressUpdates: false,
			target: 'invalid hostname',
			packets: 1,
			protocol: 'ICMP',
			port: 80,
			ipVersion: 4,
			timeout: 5,
		};
		const result = await runCommand(new PingCommand(), options);

		expect(result.status).to.equal('failed');
		expect(result.failureSource).to.equal('target');
		expect(result.rawOutput).to.be.a('string').and.not.empty;
	});
});
