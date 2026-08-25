import { expect } from 'chai';
import { ipEquals } from '../../src/lib/ip.js';
import { cachedDnsLookupOne } from '../../src/lib/dns.js';
import { TracerouteCommand, traceCmd, type TraceOptions } from '../../src/command/traceroute-command.js';
import { expectFiniteNumbers, loopbackTargets, runCommand } from './command-test-helpers.js';
import { DnsServer } from './dns-server.js';

describe('traceroute compatibility', () => {
	let dnsServer: DnsServer | undefined;
	const lookup = ((hostname: string, options: any) => cachedDnsLookupOne(hostname, {
		...options,
		server: `${dnsServer!.host}:${dnsServer!.port}`,
	})) as typeof cachedDnsLookupOne;

	before(async () => {
		dnsServer = await DnsServer.start('127.0.0.1');
	});

	after(async () => {
		await dnsServer?.close();
	});

	for (const { target, ipVersion, protocol, resolvedHostname } of [
		...loopbackTargets.map(target => ({ ...target, protocol: 'ICMP' })),
		{ ...loopbackTargets[0]!, protocol: 'TCP' },
		{ ...loopbackTargets[0]!, protocol: 'UDP' },
	]) {
		it(`runs ${protocol.toLowerCase()} traceroute against IPv${ipVersion} loopback`, async () => {
			const options: TraceOptions = {
				type: 'traceroute',
				inProgressUpdates: false,
				target,
				protocol,
				port: 80,
				ipVersion,
				timeout: 5,
			};
			const result = await runCommand(new TracerouteCommand(traceCmd, lookup), options);

			expect(result.status, result.rawOutput).to.equal('finished');
			expect(ipEquals(result.resolvedAddress, target)).to.equal(true);

			if (resolvedHostname) {
				expect(result.resolvedHostname).to.equal(resolvedHostname);
				expect(result.rawOutput).to.include(`traceroute to ${resolvedHostname} (${result.resolvedAddress})`);
			}

			const targetHop = result.hops.find((hop: { resolvedAddress: string | null }) => hop.resolvedAddress && ipEquals(hop.resolvedAddress, target));

			expect(targetHop, 'responding target hop').to.not.equal(undefined);
			expect(targetHop.resolvedHostname).to.equal('_gateway');
			expect(targetHop.timings).to.have.length(2);

			for (const timing of targetHop.timings) {
				expect(timing.rtt).to.be.a('number').and.to.be.at.least(0);
			}

			expectFiniteNumbers(result);
		});
	}
});
