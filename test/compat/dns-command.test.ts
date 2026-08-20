import { expect } from 'chai';
import { ipEquals } from '../../src/lib/ip.js';
import { DnsCommand, dnsCmd, type DnsOptions } from '../../src/command/dns-command.js';
import { expectFiniteNumbers, runCommand } from './command-test-helpers.js';
import { DnsServer } from './dns-server.js';

describe('dig compatibility', () => {
	let ipv4Server: DnsServer | undefined;
	let ipv6Server: DnsServer | undefined;
	let startupError: unknown;

	before(async () => {
		try {
			ipv4Server = await DnsServer.start('127.0.0.1');
			ipv6Server = await DnsServer.start('::1');
		} catch (error) {
			startupError = error;
			throw error;
		}
	});

	after(async () => {
		const results = await Promise.allSettled([ ipv4Server, ipv6Server ]
			.filter((server): server is DnsServer => server !== undefined)
			.map(server => server.close()));
		const closeFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

		if (!startupError && closeFailure) {
			throw closeFailure.reason;
		}
	});

	it('starts and closes DNS servers repeatedly', async () => {
		for (let index = 0; index < 20; index++) {
			const server = await DnsServer.start('127.0.0.1');
			await server.close();
		}
	});

	for (const { server, protocol, queryType, target, expected } of [
		{ server: 'ipv4', protocol: 'UDP', queryType: 'A', target: 'ipv4.compat.test', expected: '127.0.0.1' },
		{ server: 'ipv4', protocol: 'TCP', queryType: 'AAAA', target: 'ipv6.compat.test', expected: '::1' },
		{ server: 'ipv6', protocol: 'UDP', queryType: 'A', target: 'ipv4.compat.test', expected: '127.0.0.1' },
		{ server: 'ipv6', protocol: 'TCP', queryType: 'AAAA', target: 'ipv6.compat.test', expected: '::1' },
	] as const) {
		it(`queries ${queryType} over ${protocol} using the ${server} resolver`, async () => {
			const dnsServer = server === 'ipv4' ? ipv4Server! : ipv6Server!;
			const options: DnsOptions = {
				type: 'dns',
				inProgressUpdates: false,
				target,
				protocol,
				port: dnsServer.port,
				resolver: dnsServer.host,
				trace: false,
				query: { type: queryType },
				ipVersion: server === 'ipv4' ? 4 : 6,
				timeout: 5,
			};
			const result = await runCommand(new DnsCommand(dnsCmd), options);

			expect(result.status, result.rawOutput).to.equal('finished');
			expect(result.statusCode).to.equal(0);
			expect(result.answers.some((answer: { value: string }) => ipEquals(answer.value, expected))).to.equal(true);
			expectFiniteNumbers(result);
		});
	}

	for (const { target, statusCode } of [
		{ target: 'nxdomain.compat.test', statusCode: 3 },
		{ target: 'servfail.compat.test', statusCode: 2 },
	]) {
		it(`returns DNS status ${statusCode} for ${target}`, async () => {
			const options: DnsOptions = {
				type: 'dns',
				inProgressUpdates: false,
				target,
				protocol: 'UDP',
				port: ipv4Server!.port,
				resolver: ipv4Server!.host,
				trace: false,
				query: { type: 'A' },
				ipVersion: 4,
				timeout: 5,
			};
			const result = await runCommand(new DnsCommand(dnsCmd), options);

			expect(result.status, result.rawOutput).to.equal('finished');
			expect(result.statusCode).to.equal(statusCode);
			expectFiniteNumbers(result);
		});
	}

	it('classifies a refused resolver connection', async () => {
		const port = await DnsServer.getUnusedPort('127.0.0.1');
		const options: DnsOptions = {
			type: 'dns',
			inProgressUpdates: false,
			target: 'ipv4.compat.test',
			protocol: 'TCP',
			port,
			resolver: '127.0.0.1',
			trace: false,
			query: { type: 'A' },
			ipVersion: 4,
			timeout: 5,
		};
		const result = await runCommand(new DnsCommand(dnsCmd), options);

		expect(result.status).to.equal('failed');
		expect(result.failureSource).to.equal('resolver');
		expect(result.rawOutput).to.be.a('string').and.not.empty;
	});

	it('classifies a silent resolver timeout', async () => {
		const options: DnsOptions = {
			type: 'dns',
			inProgressUpdates: false,
			target: 'silent.compat.test',
			protocol: 'UDP',
			port: ipv4Server!.port,
			resolver: ipv4Server!.host,
			trace: false,
			query: { type: 'A' },
			ipVersion: 4,
			timeout: 5,
		};
		const result = await runCommand(new DnsCommand(dnsCmd), options);

		expect(result.status).to.equal('failed');
		expect(result.failureSource).to.equal('resolver');
		expect(result.rawOutput).to.be.a('string').and.not.empty;
	});
});
