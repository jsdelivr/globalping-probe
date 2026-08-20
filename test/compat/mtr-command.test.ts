import { expect } from 'chai';
import { ipEquals } from '../../src/lib/ip.js';
import { cachedDnsLookup } from '../../src/lib/dns.js';
import { MtrCommand, mtrCmd, type MtrOptions } from '../../src/command/mtr-command.js';
import { expectFiniteNumbers, loopbackTargets, runCommand } from './command-test-helpers.js';
import { DnsServer } from './dns-server.js';

describe('native MTR command compatibility', () => {
	for (const { target, ipVersion } of loopbackTargets) {
		it(`runs MTR against IPv${ipVersion} loopback`, async () => {
			const options: MtrOptions = {
				type: 'mtr',
				inProgressUpdates: false,
				target,
				protocol: 'icmp',
				port: 80,
				packets: 1,
				ipVersion,
				timeout: 5,
			};
			const result = await runCommand(new MtrCommand(mtrCmd), options);

			expect(result.status).to.equal('finished');
			expect(ipEquals(result.resolvedAddress, target)).to.equal(true);
			expect(result.hops.some((hop: { resolvedAddress: string | null; timings: unknown[] }) => hop.resolvedAddress && ipEquals(hop.resolvedAddress, target) && hop.timings.length > 0)).to.equal(true);
			expectFiniteNumbers(result);
		});
	}

	describe('hostname target', () => {
		let dnsServer: DnsServer | undefined;

		before(async () => {
			dnsServer = await DnsServer.start('127.0.0.1');
		});

		after(async () => {
			await dnsServer?.close();
		});

		it('runs MTR against a hostname resolving to loopback', async () => {
			const server = dnsServer!;
			const lookup = ((hostname: string, options: any) => cachedDnsLookup(hostname, {
				...options,
				server: `${server.host}:${server.port}`,
			})) as typeof cachedDnsLookup;
			const result = await runCommand(new MtrCommand(mtrCmd, lookup), {
				type: 'mtr',
				inProgressUpdates: false,
				target: 'mtr.compat.test',
				protocol: 'icmp',
				port: 80,
				packets: 1,
				ipVersion: 4,
				timeout: 5,
			} satisfies MtrOptions);

			expect(result.status).to.equal('finished');
			expect(result.resolvedAddress).to.equal('127.0.0.1');
			expectFiniteNumbers(result);
		});
	});
});
