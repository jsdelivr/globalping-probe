import { expect } from 'chai';
import { ipEquals } from '../../src/lib/ip.js';
import { cachedDnsLookupOne } from '../../src/lib/dns.js';
import { PingCommand, pingCmd, type PingOptions } from '../../src/command/ping-command.js';
import { expectFiniteNumbers, loopbackTargets, runCommand } from './command-test-helpers.js';
import { DnsServer } from './dns-server.js';

describe('ping compatibility', () => {
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

	for (const { target, ipVersion, resolvedHostname } of loopbackTargets) {
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
			const result = await runCommand(new PingCommand(pingCmd, lookup), options);

			expect(result.status, result.rawOutput).to.equal('finished');
			expect(ipEquals(result.resolvedAddress, target)).to.equal(true);

			if (resolvedHostname) {
				expect(result.resolvedHostname).to.equal(resolvedHostname);
				expect(result.rawOutput).to.include(`${resolvedHostname} (${result.resolvedAddress})`);
			}

			expect(result.timings).to.have.length(1);
			expect(result.timings[0].rtt).to.be.a('number').and.to.be.at.least(0);
			expect(result.timings[0].ttl).to.be.a('number').and.to.be.greaterThan(0);

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

	it('classifies an unresolvable hostname', async () => {
		const options: PingOptions = {
			type: 'ping',
			inProgressUpdates: false,
			target: 'nonexistent.invalid',
			packets: 1,
			protocol: 'ICMP',
			port: 80,
			ipVersion: 4,
			timeout: 5,
		};
		const result = await runCommand(new PingCommand(pingCmd, lookup), options);

		expect(result.status).to.equal('failed');
		expect(result.failureSource).to.equal('target');
		expect(result.rawOutput).to.be.a('string').and.not.empty;
	});
});
