import { expect } from 'chai';
import { ipEquals } from '../../src/lib/ip.js';
import { cachedDnsLookupOne } from '../../src/lib/dns.js';
import { MtrCommand, mtrCmd, type MtrOptions } from '../../src/command/mtr-command.js';
import { expectFiniteNumbers, loopbackTargets, runCommand } from './command-test-helpers.js';
import { DnsServer } from './dns-server.js';

const expectTargetHop = (result: any, target: string, asn: number) => {
	const targetHop = result.hops.find((hop: { resolvedAddress: string | null }) => hop.resolvedAddress && ipEquals(hop.resolvedAddress, target));

	expect(targetHop, 'responding target hop').to.not.equal(undefined);
	expect(targetHop.resolvedHostname).to.equal('_gateway');
	expect(targetHop.asn).to.deep.equal([ asn ]);
	expect(targetHop.timings).to.have.length.greaterThan(0);

	for (const timing of targetHop.timings) {
		expect(timing.rtt).to.be.a('number').and.to.be.at.least(0);
	}

	expect(targetHop.stats).to.deep.include({
		total: 1,
		rcv: 1,
		drop: 0,
		loss: 0,
	});

	expect(targetHop.stats.min).to.be.a('number');
	expect(targetHop.stats.avg).to.be.a('number');
	expect(targetHop.stats.max).to.be.a('number');
	expect(targetHop.stats.stDev).to.be.a('number');
	expect(targetHop.stats.jMin).to.be.a('number');
	expect(targetHop.stats.jMax).to.be.a('number');
	expect(targetHop.stats.jAvg).to.be.a('number');
};

describe('mtr compatibility', () => {
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

	for (const { target, ipVersion, protocol, resolvedHostname, asn } of [
		...loopbackTargets.map(target => ({ ...target, protocol: 'icmp' })),
		{ ...loopbackTargets[0]!, protocol: 'tcp' },
		{ ...loopbackTargets[0]!, protocol: 'udp' },
	]) {
		it(`runs ${protocol} mtr against IPv${ipVersion} loopback`, async () => {
			const options: MtrOptions = {
				type: 'mtr',
				inProgressUpdates: false,
				target,
				protocol,
				port: 80,
				packets: 1,
				ipVersion,
				timeout: 5,
			};
			const result = await runCommand(new MtrCommand(mtrCmd, lookup), options);

			expect(result.status, result.rawOutput).to.equal('finished');
			expect(ipEquals(result.resolvedAddress, target)).to.equal(true);

			if (resolvedHostname) {
				expect(result.resolvedHostname).to.equal(resolvedHostname);
			}

			expect(result.rawOutput).to.include(`AS${asn}`);
			expectTargetHop(result, target, asn);
			expectFiniteNumbers(result);
		});
	}

	describe('hostname target', () => {
		it('runs mtr against a hostname resolving to loopback', async () => {
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

			expect(result.status, result.rawOutput).to.equal('finished');
			expect(result.resolvedAddress).to.equal('127.0.0.2');
			expect(result.resolvedHostname).to.equal('mtr.compat.test');
			expect(result.rawOutput).to.include('AS64512');
			expectTargetHop(result, '127.0.0.2', 64512);
			expectFiniteNumbers(result);
		});
	});
});
