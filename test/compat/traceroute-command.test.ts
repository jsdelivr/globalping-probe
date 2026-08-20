import { expect } from 'chai';
import { ipEquals } from '../../src/lib/ip.js';
import { TracerouteCommand, traceCmd, type TraceOptions } from '../../src/command/traceroute-command.js';
import { expectFiniteNumbers, loopbackTargets, runCommand } from './command-test-helpers.js';

describe('native traceroute command compatibility', () => {
	for (const { target, ipVersion } of loopbackTargets) {
		it(`runs traceroute against IPv${ipVersion} loopback`, async () => {
			const options: TraceOptions = {
				type: 'traceroute',
				inProgressUpdates: false,
				target,
				protocol: 'ICMP',
				port: 80,
				ipVersion,
				timeout: 5,
			};
			const result = await runCommand(new TracerouteCommand(traceCmd), options);

			expect(result.status).to.equal('finished');
			expect(ipEquals(result.resolvedAddress, target)).to.equal(true);
			expect(result.hops.some((hop: { resolvedAddress: string | null; timings: unknown[] }) => hop.resolvedAddress && ipEquals(hop.resolvedAddress, target) && hop.timings.length > 0)).to.equal(true);
			expectFiniteNumbers(result);
		});
	}
});
