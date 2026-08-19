import { expect } from 'chai';
import { EventEmitter } from 'node:events';
import { ipEquals } from '../../src/lib/ip.js';
import { cachedDnsLookup } from '../../src/lib/dns.js';
import { PingCommand, type PingOptions } from '../../src/command/ping-command.js';
import { TracerouteCommand, traceCmd, type TraceOptions } from '../../src/command/traceroute-command.js';
import { MtrCommand, mtrCmd, type MtrOptions } from '../../src/command/mtr-command.js';
import { DnsCommand, dnsCmd, type DnsOptions } from '../../src/command/dns-command.js';
import { DnsServer } from './dns-server.js';

type CommandResult = Record<string, any> & {
	status?: string;
	failureSource?: string;
	rawOutput?: string;
	resolvedAddress?: string | null;
	timings?: unknown[];
	hops?: Array<{ resolvedAddress: string | null; timings: unknown[] }>;
	statusCode?: number | null;
	answers?: Array<{ value: string }>;
};

const finiteNumbers = (value: unknown): number[] => {
	if (typeof value === 'number') {
		return [ value ];
	}

	if (Array.isArray(value)) {
		return value.flatMap(finiteNumbers);
	}

	if (value && typeof value === 'object') {
		return Object.values(value).flatMap(finiteNumbers);
	}

	return [];
};

const runCommand = async (command: { run: (...args: any[]) => Promise<unknown> }, options: unknown): Promise<CommandResult> => {
	const socket = new EventEmitter();
	let result: CommandResult | undefined;

	socket.on('probe:measurement:result', (event) => {
		result = event.result;
	});

	await command.run(socket as any, 'measurement', 'test', options);
	expect(result, 'command result').to.not.equal(undefined);
	return result!;
};

const expectFiniteNumbers = (result: CommandResult) => {
	for (const value of finiteNumbers(result)) {
		expect(Number.isFinite(value)).to.equal(true);
	}
};

const loopbackTargets = [
	{ target: '127.0.0.1', ipVersion: 4 as const },
	{ target: '0:0:0:0:0:0:0:1', ipVersion: 6 as const },
];

describe('native command compatibility', () => {
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

			expect(result.status).to.equal('finished');
			expect(ipEquals(result.resolvedAddress, target)).to.equal(true);
			expect(result.timings).to.have.length.greaterThan(0);
			expectFiniteNumbers(result);
		});

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

	it('classifies a native ping name-resolution failure', async () => {
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

	describe('DNS', () => {
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

		it('runs MTR against a hostname resolving to loopback', async () => {
			const server = ipv4Server!;
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

				expect(result.status).to.equal('finished');
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

				expect(result.status).to.equal('finished');
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
});
