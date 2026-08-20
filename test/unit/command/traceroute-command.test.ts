import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import { type ExecaError } from 'execa';
import { chunkOutput, getCmdMock, getCmdMockResult, getExecaMock } from '../../utils.js';
import {
	TracerouteCommand,
	argBuilder,
	normalizeTracerouteOutput,
	type TraceOptions,
} from '../../../src/command/traceroute-command.js';
import type { CommandTargetLookup } from '../../../src/helper/resolve-command-target.js';
import { InternalError } from '../../../src/lib/internal-error.js';

const numericFixtureOutput = (output: string): string => output.split('\n').map((line, index) => {
	if (index === 0) {
		return line.replace(/traceroute to \S+ \(([^)]+)\)/, 'traceroute to $1 ($1)');
	}

	return line.replace(/\S+\s+\(([^)]+)\)/g, '$1');
}).join('\n');

const fixtureResolver = (output: string): CommandTargetLookup => {
	const targetAddress = output.match(/traceroute to \S+ \(([^)]+)\)/)?.[1];
	const hostnames = new Map<string, string>();

	for (const match of output.matchAll(/(\S+)\s+\(([^)]+)\)/g)) {
		if (match[1] !== match[2]) {
			hostnames.set(match[2]!, match[1]!);
		}
	}

	return (async (target: string, options: any) => {
		if (options.rrtype) {
			const hostname = hostnames.get(target);

			if (hostname) {
				return hostname;
			}

			throw new Error('ENODATA');
		}

		return targetAddress!;
	}) as CommandTargetLookup;
};

const dnsResolver = (address: string): CommandTargetLookup => (async (_target: string, options: any) => {
	if (options.rrtype) {
		throw new Error('ENODATA');
	}

	return address;
}) as CommandTargetLookup;

describe('trace command', () => {
	describe('argument builder', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'traceroute' as TraceOptions['type'],
				timeout: 5,
				target: 'google.com',
				port: 80,
				protocol: 'TCP',
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const args = argBuilder(options);
			const joinedArgs = args.join(' ');

			expect(args).to.include('-4');
			expect(args).to.include('-n');
			expect(args[args.length - 1]).to.equal(options.target);
			expect(joinedArgs).to.contain('-m 20');
			expect(joinedArgs).to.contain('-N 20');
			expect(joinedArgs).to.contain('-w 1.5');
			expect(joinedArgs).to.contain('-q 2');
			expect(joinedArgs).to.contain(`--${options.protocol.toLowerCase()}`);
			expect(joinedArgs).to.contain(`-p ${options.port}`);
		});

		for (const { timeout, wait } of [
			{ timeout: 10, wait: 3 },
			{ timeout: 16, wait: 4.8 },
			{ timeout: 17, wait: 5 },
			{ timeout: 30, wait: 5 },
		]) {
			it(`should derive a ${wait} second native wait from a ${timeout} second timeout`, () => {
				const args = argBuilder({
					type: 'traceroute',
					timeout,
					target: 'google.com',
					port: 80,
					protocol: 'TCP',
					inProgressUpdates: false,
					ipVersion: 4,
				});

				expect(args.join(' ')).to.contain(`-w ${wait}`);
			});
		}

		describe('ipVersion', () => {
			it('should set -4 flag', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'google.com',
					port: 80,
					protocol: 'TCP',
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args).to.include('-4');
			});

			it('should set -6 flag', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'google.com',
					port: 80,
					protocol: 'TCP',
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const args = argBuilder(options);
				expect(args).to.include('-6');
			});
		});

		describe('port', () => {
			it('should set -p 90 flag (TCP)', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'google.com',
					port: 90,
					protocol: 'TCP',
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain(`-p ${options.port}`);
			});

			it('should NOT set -p flag (UDP)', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'google.com',
					port: 90,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.not.contain(`-p ${options.port}`);
			});
		});

		describe('protocol', () => {
			it('should set --tcp flag (TCP)', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'google.com',
					port: 90,
					protocol: 'TCP',
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain('--tcp');
			});

			it('should NOT set --udp flag (UDP)', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'google.com',
					port: 90,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain('--udp');
			});
		});
	});

	describe('output normalization', () => {
		it('restores the target hostname immediately and hop hostnames when available', () => {
			const output = 'traceroute to 1.1.1.1 (1.1.1.1), 20 hops max, 60 byte packets\n'
				+ ' 1  8.8.8.8  1.25 ms  1.50 ms\n'
				+ ' 2  1.1.1.1  4.25 ms  4.50 ms\n'
				+ 'diagnostic 9.9.9.9';
			const hostnames = new Map([
				[ '1.1.1.1', 'one.one.one.one' ],
				[ '8.8.8.8', 'dns.google' ],
				[ '9.9.9.9', 'dns.quad9.net' ],
			]);
			const expected = 'traceroute to one.one.one.one (1.1.1.1), 20 hops max, 60 byte packets\n'
				+ ' 1  dns.google (8.8.8.8)  1.25 ms  1.50 ms\n'
				+ ' 2  one.one.one.one (1.1.1.1)  4.25 ms  4.50 ms\n'
				+ 'diagnostic 9.9.9.9';

			expect(normalizeTracerouteOutput(
				output,
				'1.1.1.1',
				'one.one.one.one',
				[ '8.8.8.8', '1.1.1.1' ],
				hostnames,
			)).to.equal(expected);
		});
	});

	describe('command handler', () => {
		const sandbox = sinon.createSandbox();
		const mockSocket = sandbox.createStubInstance(Socket);

		beforeEach(() => {
			sandbox.reset();
		});

		it('resolves the target before traceroute and keeps fast PTR enrichment out of progress', async () => {
			const options = {
				type: 'traceroute' as TraceOptions['type'],
				timeout: 5,
				target: 'example.com',
				port: 53,
				protocol: 'UDP',
				inProgressUpdates: true,
				ipVersion: 4,
			};
			const lookup = sandbox.stub().callsFake(async (_target: string, lookupOptions: { rrtype?: string }) => {
				if (!lookupOptions.rrtype) {
					return '1.1.1.1';
				}

				return 'dns.google';
			});
			const mockCmd = getExecaMock();
			const cmd = sandbox.stub().returns(mockCmd);
			const command = new TracerouteCommand(cmd, lookup);
			const runPromise = command.run(mockSocket as any, 'measurement', 'test', options);
			const rawOutput = 'traceroute to 1.1.1.1 (1.1.1.1), 20 hops max, 60 byte packets\n'
				+ ' 1  192.168.0.1  0.25 ms  0.50 ms\n'
				+ ' 2  8.8.8.8  1.25 ms  1.50 ms\n'
				+ ' 3  1.1.1.1  4.25 ms  4.50 ms';
			const expectedProgressOutput = 'traceroute to example.com (1.1.1.1), 20 hops max, 60 byte packets\n'
				+ ' 1  _gateway (192.168.0.1)  0.25 ms  0.50 ms\n'
				+ ' 2  8.8.8.8 (8.8.8.8)  1.25 ms  1.50 ms\n'
				+ ' 3  example.com (1.1.1.1)  4.25 ms  4.50 ms\n';

			await new Promise(resolve => setImmediate(resolve));
			mockCmd.stdout.write(`${rawOutput.split('\n').slice(0, 3).join('\n')}\n`);
			await new Promise(resolve => setTimeout(resolve, 150));
			mockCmd.stdout.write(`${rawOutput.split('\n')[3]}\n`);
			await new Promise(resolve => setTimeout(resolve, 150));
			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(cmd.firstCall.args[0].target).to.equal('1.1.1.1');
			const progress = mockSocket.emit.getCalls()
				.filter(call => call.args[0] === 'probe:measurement:progress')
				.map(call => (call.args[1] as any).result.rawOutput);
			expect(progress.join('')).to.equal(expectedProgressOutput);
			const result = (mockSocket.emit.lastCall.args[1] as any).result;
			expect(result.rawOutput).to.include('dns.google (8.8.8.8)');
			expect(result.resolvedHostname).to.equal('example.com');
		});

		it('normalizes responder addresses before enrichment', async () => {
			const targetAddress = '2606:4700:4700::1111';
			const routerAddress = '2606:4700:4700::1001';
			const lookup = sandbox.stub().callsFake(async (target: string, options: { rrtype?: string }) => {
				if (!options.rrtype) {
					return targetAddress;
				}

				if (target === routerAddress) {
					return 'router.example';
				}

				throw new Error('ENODATA');
			});
			const mockCmd = getExecaMock();
			const command = new TracerouteCommand((): any => mockCmd, lookup);
			const runPromise = command.run(mockSocket as any, 'measurement', 'test', {
				type: 'traceroute', timeout: 5, target: 'example.com', port: 53, protocol: 'UDP', inProgressUpdates: false, ipVersion: 6,
			});
			const rawOutput = `traceroute to ${targetAddress} (${targetAddress}), 20 hops max, 60 byte packets\n`
				+ ' 1  192.168.0.1  0.25 ms  0.50 ms\n'
				+ ' 2  2606:4700:4700:0000:0000:0000:0000:1001  1.25 ms  1.50 ms\n'
				+ ` 3  ${targetAddress}  4.25 ms  4.50 ms`;

			mockCmd.resolve({ stdout: rawOutput });
			const result = await runPromise as any;

			expect(result.rawOutput).to.include(`router.example (${routerAddress})`);
			expect(result.hops[1].resolvedAddress).to.equal(routerAddress);
		});

		it('starts hop lookups during execution without progress updates', async () => {
			const options = {
				type: 'traceroute' as TraceOptions['type'],
				timeout: 5,
				target: 'example.com',
				port: 53,
				protocol: 'UDP',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			let resolvePtr!: (record: string) => void;
			const ptrResult = new Promise<string>((resolve) => {
				resolvePtr = resolve;
			});
			const lookup = sandbox.stub().callsFake((_target: string, lookupOptions: { rrtype?: string }) => (
				lookupOptions.rrtype ? ptrResult : Promise.resolve('1.1.1.1')
			));
			const mockCmd = getExecaMock();
			const command = new TracerouteCommand((): any => mockCmd, lookup);
			const runPromise = command.run(mockSocket as any, 'measurement', 'test', options);
			const rawOutput = 'traceroute to 1.1.1.1 (1.1.1.1), 20 hops max, 60 byte packets\n'
				+ ' 1  192.168.0.1  0.25 ms  0.50 ms\n'
				+ ' 2  8.8.8.8  1.25 ms  1.50 ms\n'
				+ ' 3  1.1.1.1  4.25 ms  4.50 ms';

			await new Promise(resolve => setImmediate(resolve));
			mockCmd.stdout.write(`${rawOutput}\n`);
			await new Promise(resolve => setTimeout(resolve, 150));

			const startedBeforeCompletion = lookup.calledWithMatch('8.8.8.8', { rrtype: 'PTR' });
			const progressCount = mockSocket.emit.getCalls().filter(call => call.args[0] === 'probe:measurement:progress').length;
			let finished = false;
			void runPromise.then(() => {
				finished = true;
			});

			mockCmd.resolve({ stdout: rawOutput });
			await new Promise(resolve => setImmediate(resolve));

			expect(finished).to.be.false;

			resolvePtr('dns.google');
			await runPromise;

			expect(startedBeforeCompletion).to.be.true;
			expect(mockSocket.emit.getCalls().filter(call => call.args[0] === 'probe:measurement:progress')).to.have.length(progressCount);
			expect((mockSocket.emit.lastCall.args[1] as any).result.rawOutput).to.include('dns.google (8.8.8.8)');
		});

		it('applies completed hop lookups to failed output', async () => {
			const lookup = sandbox.stub().callsFake(async (target: string, lookupOptions: { rrtype?: string }) => {
				if (!lookupOptions.rrtype) {
					return '1.1.1.1';
				}

				if (target === '8.8.8.8') {
					return 'dns.google';
				}

				throw new Error('ENODATA');
			});
			const mockCmd = getExecaMock();
			const command = new TracerouteCommand((): any => mockCmd, lookup);
			const runPromise = command.run(mockSocket as any, 'measurement', 'test', {
				type: 'traceroute',
				timeout: 5,
				target: 'example.com',
				port: 53,
				protocol: 'UDP',
				inProgressUpdates: true,
				ipVersion: 4,
			});
			const rawOutput = 'traceroute to 1.1.1.1 (1.1.1.1), 20 hops max, 60 byte packets\n'
				+ ' 1  192.168.0.1  0.25 ms  0.50 ms\n'
				+ ' 2  8.8.8.8  1.25 ms  1.50 ms';
			const error = new Error('Failed') as ExecaError;
			error.stderr = '';
			error.timedOut = false;
			error.stdout = rawOutput;

			await new Promise(resolve => setImmediate(resolve));
			mockCmd.stdout.write(`${rawOutput}\n`);
			await new Promise(resolve => setTimeout(resolve, 150));
			mockCmd.reject(error);
			await runPromise;

			expect((mockSocket.emit.lastCall.args[1] as any).result.rawOutput).to.include('dns.google (8.8.8.8)');
		});

		it('uses the resolved target for top-level metadata when the last hop differs', async () => {
			const options = {
				type: 'traceroute' as TraceOptions['type'],
				timeout: 5,
				target: 'example.com',
				port: 53,
				protocol: 'UDP',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const lookup = sandbox.stub().callsFake(async (_target: string, lookupOptions: { rrtype?: string }) => (
				lookupOptions.rrtype ? 'last-hop.example' : '1.1.1.1'
			));
			const mockCmd = getExecaMock();
			const command = new TracerouteCommand((): any => mockCmd, lookup);
			const runPromise = command.run(mockSocket as any, 'measurement', 'test', options);
			const rawOutput = 'traceroute to 1.1.1.1 (1.1.1.1), 20 hops max, 60 byte packets\n'
				+ ' 1  192.0.2.1  0.25 ms  0.50 ms\n'
				+ ' 2  8.8.8.8  1.25 ms  1.50 ms';

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			const result = (mockSocket.emit.lastCall.args[1] as any).result;
			expect(result.resolvedAddress).to.equal('1.1.1.1');
			expect(result.resolvedHostname).to.equal('example.com');
			expect(result.hops[1].resolvedHostname).to.equal('last-hop.example');
		});

		it('classifies an owned target lookup deadline as resolver', async () => {
			const lookup = sandbox.stub().callsFake((_target: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			}));
			const cmd = sandbox.stub();
			const command = new TracerouteCommand(cmd, lookup);

			await command.run(mockSocket as any, 'measurement', 'test', {
				type: 'traceroute', timeout: 0, target: 'example.com', port: 53, protocol: 'UDP', inProgressUpdates: false, ipVersion: 4,
			});

			expect(cmd.notCalled).to.be.true;
			expect((mockSocket.emit.lastCall.args[1] as any).result.failureSource).to.equal('resolver');
		});

		describe('mock', () => {
			it('should run and parse trace with progress messages', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'hello.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
					ipVersion: 4,
				};

				const testCase = 'trace-success-linux';
				const fixtureOutput = getCmdMock(testCase);
				const rawOutput = numericFixtureOutput(fixtureOutput);
				const expectedResult = getCmdMockResult(testCase) as any;
				expectedResult.result.resolvedHostname = options.target;

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd, fixtureResolver(fixtureOutput));
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const { lines, emitChunks } = chunkOutput(rawOutput);

				await emitChunks(mockCmd.stdout);

				mockCmd.resolve({ stdout: rawOutput });
				await runPromise;

				expect(mockSocket.emit.callCount).to.equal(lines.length + 1);
				expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should run and parse trace', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'hello.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const testCase = 'trace-success-linux';
				const fixtureOutput = getCmdMock(testCase);
				const rawOutput = numericFixtureOutput(fixtureOutput);
				const expectedResult = getCmdMockResult(testCase) as any;
				expectedResult.result.resolvedHostname = options.target;

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd, fixtureResolver(fixtureOutput));
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const { emitChunks } = chunkOutput(rawOutput);

				await emitChunks(mockCmd.stdout);

				mockCmd.resolve({ stdout: rawOutput });
				await runPromise;

				expect(mockSocket.emit.callCount).to.equal(1);
				expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should run and parse trace - ipv6-trace-success', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const testCase = 'ipv6-trace-success';
				const fixtureOutput = getCmdMock(testCase);
				const rawOutput = numericFixtureOutput(fixtureOutput);
				const expectedResult = getCmdMockResult(testCase) as any;
				expectedResult.result.resolvedHostname = options.target;
				expectedResult.result.hops.at(-1).resolvedHostname = options.target;
				expectedResult.result.rawOutput = expectedResult.result.rawOutput.replaceAll('hem08s10-in-x0e.1e100.net', options.target);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd, fixtureResolver(fixtureOutput));
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const { emitChunks } = chunkOutput(rawOutput);

				await emitChunks(mockCmd.stdout);

				mockCmd.resolve({ stdout: rawOutput });
				await runPromise;

				expect(mockSocket.emit.callCount).to.equal(1);
				expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should run and parse trace - ipv6-trace-success-ip', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: '2a00:1450:4026:808::200f',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const testCase = 'ipv6-trace-success-ip';
				const fixtureOutput = getCmdMock(testCase);
				const rawOutput = numericFixtureOutput(fixtureOutput);
				const expectedResult = getCmdMockResult(testCase) as any;
				expectedResult.result.rawOutput = expectedResult.result.rawOutput.replace(
					`traceroute to ${options.target} (${options.target})`,
					`traceroute to hem08s10-in-x0f.1e100.net (${options.target})`,
				);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd, fixtureResolver(fixtureOutput));
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const { emitChunks } = chunkOutput(rawOutput);

				await emitChunks(mockCmd.stdout);

				mockCmd.resolve({ stdout: rawOutput });
				await runPromise;

				expect(mockSocket.emit.callCount).to.equal(1);
				expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should not start traceroute when target resolution rejects a private address', async () => {
				const cmd = sandbox.stub();
				const lookup = sandbox.stub().rejects(new InternalError('Private IP ranges are not allowed.', true, 'target'));
				const traceroute = new TracerouteCommand(cmd, lookup);

				await traceroute.run(mockSocket as any, 'measurement', 'test', {
					type: 'traceroute',
					timeout: 5,
					target: 'hello.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
					ipVersion: 4,
				});

				expect(cmd.notCalled).to.be.true;

				expect(mockSocket.emit.firstCall.args[1]).to.deep.include({
					result: {
						status: 'failed',
						failureSource: 'target',
						rawOutput: 'Private IP ranges are not allowed.',
					},
				});
			});

			it('should classify a timeout without unanswered probes as internal', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'hello.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
					ipVersion: 4,
				};
				const mockCmd = getExecaMock();
				const ping = new TracerouteCommand((): any => mockCmd, dnsResolver('216.239.38.21'));
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const timeoutError = new Error('Timeout') as ExecaError;
				timeoutError.stderr = '';
				timeoutError.timedOut = true;

				timeoutError.stdout = 'traceroute to hello.com (216.239.38.21), 20 hops max, 60 byte packets\n'
					+ ' 1  intermediate.example (192.0.2.1)  7.99 ms  8.12 ms';

				mockCmd.reject(timeoutError);

				await runPromise;

				expect(mockSocket.emit.callCount).to.equal(1);

				expect(mockSocket.emit.lastCall.args).to.deep.equal([
					'probe:measurement:result',
					{
						testId: 'test',
						measurementId: 'measurement',
						result: {
							status: 'failed',
							failureSource: 'internal',
							rawOutput: 'traceroute to hello.com (216.239.38.21), 20 hops max, 60 byte packets\n'
								+ ' 1  intermediate.example (192.0.2.1)  7.99 ms  8.12 ms\n'
								+ '\n'
								+ 'The measurement command timed out.',
						},
					},
				]);
			});

			it('should classify a timeout containing unanswered probes as target', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'hello.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 4,
				};
				const mockCmd = getExecaMock();
				const command = new TracerouteCommand((): any => mockCmd, dnsResolver('216.239.38.21'));
				const runPromise = command.run(mockSocket as any, 'measurement', 'test', options);
				const timeoutError = new Error('Timeout') as ExecaError;
				timeoutError.stderr = '';
				timeoutError.timedOut = true;
				timeoutError.stdout = 'traceroute to hello.com (216.239.38.21), 20 hops max, 60 byte packets\n 1  * *';
				mockCmd.reject(timeoutError);

				await runPromise;

				expect((mockSocket.emit.firstCall.args[1] as any).result.failureSource).to.equal('target');
			});

			it('should classify an execa timeout after the target responds with an equivalent IPv6 address as internal', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'hello.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 6,
				};
				const mockCmd = getExecaMock();
				const traceroute = new TracerouteCommand((): any => mockCmd, dnsResolver('2606:4700:4700::1111'));
				const runPromise = traceroute.run(mockSocket as any, 'measurement', 'test', options);
				const timeoutError = new Error('Timeout') as ExecaError;
				timeoutError.stderr = '';
				timeoutError.timedOut = true;

				timeoutError.stdout = 'traceroute to hello.com (2606:4700:4700:0000:0000:0000:0000:1111), 20 hops max, 60 byte packets\n'
					+ ' 1  hello.com (2606:4700:4700::1111)  7.99 ms  8.12 ms';

				mockCmd.reject(timeoutError);

				await runPromise;

				const result = (mockSocket.emit.lastCall.args[1] as any).result;
				expect(result.failureSource).to.equal('internal');
			});

			it('should classify an execa timeout with invalid output as internal', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'hello.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 4,
				};
				const mockCmd = getExecaMock();
				const traceroute = new TracerouteCommand((): any => mockCmd, dnsResolver('216.239.38.21'));
				const runPromise = traceroute.run(mockSocket as any, 'measurement', 'test', options);
				const timeoutError = new Error('Timeout') as ExecaError;
				timeoutError.stderr = '';
				timeoutError.timedOut = true;
				timeoutError.stdout = 'invalid partial output';
				mockCmd.reject(timeoutError);

				await runPromise;

				const result = (mockSocket.emit.lastCall.args[1] as any).result;
				expect(result.failureSource).to.equal('internal');
				expect(result.rawOutput).to.equal('invalid partial output\n\nThe measurement command timed out.');
			});

			it('should not prepend blank lines to a timeout without command output', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					timeout: 5,
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 4,
				};
				const mockCmd = getExecaMock();
				const traceroute = new TracerouteCommand((): any => mockCmd, dnsResolver('216.239.38.21'));
				const runPromise = traceroute.run(mockSocket as any, 'measurement', 'test', options);
				const timeoutError = new Error('Timeout') as ExecaError;
				timeoutError.stderr = '';
				timeoutError.stdout = '';
				timeoutError.timedOut = true;
				mockCmd.reject(timeoutError);

				await runPromise;

				const result = (mockSocket.emit.lastCall.args[1] as any).result;
				expect(result.failureSource).to.equal('internal');
				expect(result.rawOutput).to.equal('The measurement command timed out.');
			});

			for (const { expectedSource, output, timedOut } of [
				{ expectedSource: 'target', output: 'traceroute: missing.example: Name or service not known', timedOut: true },
				{ expectedSource: 'resolver', output: 'traceroute: missing.example: Temporary failure in name resolution', timedOut: true },
				{ expectedSource: 'target', output: 'traceroute to example.com (1.1.1.1), 20 hops max\n 1  192.0.2.1  1.0 ms !H', timedOut: false },
				{ expectedSource: 'internal', output: 'traceroute: connect: Network is unreachable', timedOut: false },
			] as const) {
				it(`should classify "${output}" as ${expectedSource}`, async () => {
					const options = {
						type: 'traceroute' as TraceOptions['type'],
						timeout: 5,
						target: 'example.com',
						port: 53,
						protocol: 'UDP',
						inProgressUpdates: false,
						ipVersion: 4,
					};
					const mockCmd = getExecaMock();
					const command = new TracerouteCommand((): any => mockCmd, dnsResolver('1.1.1.1'));
					const runPromise = command.run(mockSocket as any, 'measurement', 'test', options);
					const error = new Error(output) as ExecaError;
					error.stderr = '';
					error.stdout = output;
					error.timedOut = timedOut;
					mockCmd.reject(error);

					await runPromise;

					expect((mockSocket.emit.lastCall.args[1] as any).result.failureSource).to.equal(expectedSource);
				});
			}

			it('should reject private target on validation', async () => {
				try {
					await new TracerouteCommand((() => {
						throw new Error('should not be called');
					}) as any, dnsResolver('127.0.0.1')).run(mockSocket as any, 'measurement', 'test', {
						type: 'traceroute',
						timeout: 5,
						target: '127.0.0.1',
						port: 53,
						protocol: 'UDP',
						inProgressUpdates: false,
						ipVersion: 4,
					});

					expect.fail('Expected validation error');
				} catch (error: unknown) {
					expect(error).to.be.instanceOf(Error);
					expect((error as Error).message).to.equal('Private IP ranges are not allowed.');
				}
			});
		});
	});
});
