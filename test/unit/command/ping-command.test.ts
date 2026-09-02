import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import { type ExecaError, execaSync } from 'execa';
import { chunkObjectStream, chunkOutput, getCmdMock, getCmdMockResult, getExecaMock } from '../../utils.js';
import { toRawTcpOutput } from '../../../src/command/handlers/ping/tcp-ping.js';
import {
	PingCommand,
	argBuilder,
	normalizePingOutput,
	type PingOptions,
} from '../../../src/command/ping-command.js';

describe('ping command executor', () => {
	describe('argument builder (ICMP)', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: 'google.com',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};

			const args = argBuilder(options);
			const joinedArgs = args.join(' ');

			expect(args[0]).to.equal('-4');
			expect(args[1]).to.equal('-O');
			expect(args).to.include('-n');
			expect(args[args.length - 1]).to.equal(options.target);
			expect(joinedArgs).to.contain(`-c ${options.packets}`);
			expect(joinedArgs).to.contain('-i 0.2');
			expect(joinedArgs).to.contain('-W 2.6');
		});

		it('should use full interval and response wait with the default timeout', () => {
			const args = argBuilder({ type: 'ping', timeout: 10, target: 'google.com', packets: 3, protocol: 'ICMP', port: 80, inProgressUpdates: false, ipVersion: 4 });
			expect(args.join(' ')).to.contain('-i 0.5 -W 5');
		});

		it('should fit sixteen packets and the response wait into four seconds', () => {
			const args = argBuilder({ type: 'ping', timeout: 5, target: 'google.com', packets: 16, protocol: 'ICMP', port: 80, inProgressUpdates: false, ipVersion: 4 });
			expect(args.join(' ')).to.contain('-i 0.2 -W 1');
		});

		it('should increase interval and response wait gradually', () => {
			const args = argBuilder({ type: 'ping', timeout: 10, target: 'google.com', packets: 16, protocol: 'ICMP', port: 80, inProgressUpdates: false, ipVersion: 4 });
			expect(args.join(' ')).to.contain('-i 0.29 -W 3.61');
		});

		it('should preserve the status-check ping interval', () => {
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 10,
				target: 'api.globalping.io',
				packets: 6,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};

			const args = argBuilder(options, { interval: 1 });

			expect(args.join(' ')).to.contain('-i 1 -W 3');
		});

		describe('ipVersion', () => {
			it('should set -4 flag', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: 'google.com',
					packets: 1,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: false,
					ipVersion: 4 as const,
				};

				const args = argBuilder(options);
				expect(args[0]).to.equal('-4');
			});

			it('should set -6 flag', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: 'google.com',
					packets: 1,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: false,
					ipVersion: 6 as const,
				};

				const args = argBuilder(options);
				expect(args[0]).to.equal('-6');
			});
		});

		describe('packets', () => {
			it('should set -c 2 flag', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: 'google.com',
					packets: 2,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: false,
					ipVersion: 4 as const,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain('-c 2');
			});

			it('should set -c 5 flag', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: 'google.com',
					packets: 5,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: false,
					ipVersion: 4 as const,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain('-c 5');
			});
		});

		describe('target', () => {
			it('should set target at the end of array', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: 'abc.com',
					packets: 2,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: false,
					ipVersion: 4 as const,
				};

				const args = argBuilder(options);

				expect(args[args.length - 1]).to.equal('abc.com');
			});
		});
	});

	describe('output normalization', () => {
		it('restores the target hostname in headers, replies, and statistics', () => {
			const output = 'PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.\n'
				+ '64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=4.25 ms\n'
				+ '--- 1.1.1.1 ping statistics ---';
			const expected = 'PING one.one.one.one (1.1.1.1) 56(84) bytes of data.\n'
				+ '64 bytes from one.one.one.one (1.1.1.1): icmp_seq=1 ttl=57 time=4.25 ms\n'
				+ '--- one.one.one.one ping statistics ---';

			expect(normalizePingOutput(output, '1.1.1.1', 'one.one.one.one')).to.equal(expected);
		});

		it('normalizes IPv6 header whitespace before the address', () => {
			const expected = 'PING ipv6.compat.test (::1) 56 data bytes';

			expect(normalizePingOutput('PING ::1(::1) 56 data bytes', '::1', 'ipv6.compat.test')).to.equal(expected);
			expect(normalizePingOutput('PING ::1   (::1) 56 data bytes', '::1', 'ipv6.compat.test')).to.equal(expected);
		});

		it('restores the target hostname in target-originated errors only', () => {
			const output = 'From 1.1.1.1 icmp_seq=1 Destination Host Unreachable\n'
				+ 'From 10.0.0.1 icmp_seq=2 Destination Host Unreachable';
			const expected = 'From one.one.one.one (1.1.1.1) icmp_seq=1 Destination Host Unreachable\n'
				+ 'From 10.0.0.1 icmp_seq=2 Destination Host Unreachable';

			expect(normalizePingOutput(output, '1.1.1.1', 'one.one.one.one')).to.equal(expected);
		});
	});

	describe('command handler', () => {
		const sandbox = sinon.createSandbox();
		const mockedSocket = sandbox.createStubInstance(Socket);

		const fakeTcpHandler = (emit: (cb: (chunk: unknown) => void) => Promise<void>) => {
			return async (_options: unknown, onProgress?: (result: any) => void) => {
				const chunks = [];

				await emit((chunk) => {
					chunks.push(chunk);

					if (onProgress) {
						onProgress(chunk);
					}
				});

				return chunks;
			};
		};

		beforeEach(() => {
			sandbox.reset();
		});

		it('resolves the ICMP target before starting ping and restores its hostname', async () => {
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: 'example.com',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};
			const lookup = sandbox.stub();
			lookup.onFirstCall().resolves('1.1.1.1');
			const mockedCmd = getExecaMock();
			const cmd = sandbox.stub().returns(mockedCmd);
			const runPromise = new PingCommand(cmd, lookup).run(mockedSocket as any, 'measurement', 'test', options);
			const rawOutput = 'PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.\n'
				+ '64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=4.25 ms\n'
				+ '\n--- 1.1.1.1 ping statistics ---\n'
				+ '1 packets transmitted, 1 received, 0% packet loss\n'
				+ 'rtt min/avg/max/mdev = 4.250/4.250/4.250/0.000 ms';

			await new Promise(resolve => setImmediate(resolve));
			mockedCmd.stdout.write('PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.\n');
			await new Promise(resolve => setTimeout(resolve, 150));

			mockedCmd.resolve({ stdout: rawOutput });

			await runPromise;

			expect(cmd.firstCall.args[0].target).to.equal('1.1.1.1');
			const progressCall = mockedSocket.emit.getCalls().find(call => call.args[0] === 'probe:measurement:progress');
			expect((progressCall?.args[1] as any).result.rawOutput).to.equal('PING example.com (1.1.1.1) 56(84) bytes of data.\n');
			const result = (mockedSocket.emit.lastCall.args[1] as any).result;
			expect(result.rawOutput).to.include('PING example.com (1.1.1.1)');
			expect(result.rawOutput).to.include('64 bytes from example.com (1.1.1.1):');
			expect(result.resolvedHostname).to.equal('example.com');
		});

		it('does not derive target metadata from an intermediate error response', async () => {
			const lookup = sandbox.stub().resolves('1.1.1.1');
			const mockedCmd = getExecaMock();
			const command = new PingCommand(sandbox.stub().returns(mockedCmd), lookup);
			const runPromise = command.run(mockedSocket as any, 'measurement', 'test', {
				type: 'ping', timeout: 5, target: 'example.com', packets: 3, protocol: 'ICMP', port: 80, inProgressUpdates: false, ipVersion: 4,
			});
			const rawOutput = 'PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.\n'
				+ 'From 192.0.2.1 icmp_seq=1 Destination Host Unreachable\n'
				+ '\n--- 1.1.1.1 ping statistics ---\n'
				+ '1 packets transmitted, 0 received, +1 errors, 100% packet loss';

			await new Promise(resolve => setImmediate(resolve));
			mockedCmd.resolve({ stdout: rawOutput });

			const result = await runPromise as any;

			expect(result.resolvedAddress).to.equal('1.1.1.1');
			expect(result.resolvedHostname).to.equal('example.com');
		});

		it('resolves a TCP hostname before dispatching the numeric target', async () => {
			const lookup = sandbox.stub().resolves('1.1.1.1');
			const command = new PingCommand(sandbox.stub(), lookup);
			sandbox.stub(command, 'runTcp').callsFake(async (...args: any[]) => ({
				target: args[4].target,
				hostname: args[5],
			}));

			const result = await command.run(mockedSocket as any, 'measurement', 'test', {
				type: 'ping', timeout: 5, target: 'example.com', packets: 3, protocol: 'TCP', port: 80, inProgressUpdates: false, ipVersion: 4,
			});

			expect(result).to.deep.equal({ target: '1.1.1.1', hostname: 'example.com' });
		});

		it('uses a best-effort PTR hostname when dispatching a TCP IP target', async () => {
			const lookup = sandbox.stub().resolves('one.one.one.one');
			const command = new PingCommand(sandbox.stub(), lookup);
			sandbox.stub(command, 'runTcp').callsFake(async (...args: any[]) => ({
				target: args[4].target,
				hostname: args[5],
			}));

			const result = await command.run(mockedSocket as any, 'measurement', 'test', {
				type: 'ping', timeout: 5, target: '1.1.1.1', packets: 3, protocol: 'TCP', port: 80, inProgressUpdates: false, ipVersion: 4,
			});

			expect(result).to.deep.equal({ target: '1.1.1.1', hostname: 'one.one.one.one' });
		});

		for (const protocol of [ 'ICMP', 'TCP' ]) {
			it(`classifies an owned ${protocol} target lookup deadline as resolver`, async () => {
				const lookup = sandbox.stub().callsFake((_target: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				}));
				const cmd = sandbox.stub();
				const command = new PingCommand(cmd, lookup);

				await command.run(mockedSocket as any, 'measurement', 'test', {
					type: 'ping', timeout: 0, target: 'example.com', packets: 3, protocol, port: 80, inProgressUpdates: false, ipVersion: 4,
				});

				expect(cmd.notCalled).to.be.true;
				const result = (mockedSocket.emit.lastCall.args[1] as any).result;
				expect(result.failureSource).to.equal('resolver');
				expect(result.rawOutput).to.equal('The measurement timed out during DNS resolution.');
			});
		}

		const successfulCommands = [
			{ command: 'ping-success-linux', address: '172.217.20.206', hostname: 'google.com' },
			{ command: 'ping-success-linux-no-domain', address: '1.1.1.1', hostname: '1.1.1.1' },
			{ command: 'ping-no-source-ip-linux', address: '172.217.20.206', hostname: 'google.com' },
			{ command: 'ping-unreachable-linux', address: '104.18.186.31', hostname: '104.18.186.31' },
		];

		for (const { command, address, hostname } of successfulCommands) {
			it(`should run and parse successful commands - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: address,
					packets: 3,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: true,
					ipVersion: 4 as const,
				};

				const mockedCmd = getExecaMock();

				const ping = new PingCommand();

				const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options, hostname);

				const { lines, emitChunks, verifyChunks } = chunkOutput(rawOutput);

				await emitChunks(mockedCmd.stdout);

				mockedCmd.resolve({ stdout: rawOutput });
				await runPromise;

				verifyChunks(mockedSocket, lines.map(line => normalizePingOutput(line, address, hostname)));

				expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});
		}

		for (const { command, address, hostname } of successfulCommands) {
			it(`should run and parse successful commands without progress updates - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: address,
					packets: 3,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: false,
					ipVersion: 4 as const,
				};

				const mockedCmd = getExecaMock();

				const ping = new PingCommand();

				const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options, hostname);

				const { emitChunks } = chunkOutput(rawOutput);

				await emitChunks(mockedCmd.stdout);

				mockedCmd.resolve({ stdout: rawOutput });
				await runPromise;

				expect(mockedSocket.emit.callCount).to.equal(1);
				expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});
		}

		const tcpCommands = [ 'ping-success-linux-tcp', 'ping-success-linux-no-domain-tcp', 'ping-packet-loss-linux-tcp', 'ping-timeout-linux-tcp' ];

		for (const command of tcpCommands) {
			it(`should run and parse commands - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: 'google.com',
					packets: 3,
					protocol: 'TCP',
					port: 80,
					inProgressUpdates: true,
					ipVersion: 4 as const,
				};

				const ping = new PingCommand();

				const { lines, emitChunks, verifyChunks } = chunkObjectStream(rawOutput);
				const runPromise = ping.runTcp(fakeTcpHandler(emitChunks), mockedSocket as any, 'measurement', 'test', options);

				const transformedLines = lines.map((_line, index, lines) => {
					return toRawTcpOutput(lines.slice(0, index + 1).map(l => JSON.parse(l)));
				}).map((line, index, lines) => {
					return line.slice(lines[index - 1]?.length ?? 0);
				});

				await runPromise;

				verifyChunks(mockedSocket, transformedLines);

				expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});
		}

		it('should use the dynamic packet interval for TCP ping', async () => {
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 10,
				target: '1.1.1.1',
				packets: 16,
				protocol: 'TCP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};
			const tcpHandler = sandbox.stub().resolves([]);
			const ping = new PingCommand();

			await ping.runTcp(tcpHandler, mockedSocket as any, 'measurement', 'test', options, 'example.com', 8000);

			expect(tcpHandler.firstCall.args[0]).to.deep.include({
				address: '1.1.1.1',
				hostname: 'example.com',
				timeout: 8000,
				interval: 290,
			});
		});

		for (const command of tcpCommands) {
			it(`should run and parse successful commands without progress updates - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: 'google.com',
					packets: 3,
					protocol: 'TCP',
					port: 80,
					inProgressUpdates: false,
					ipVersion: 4 as const,
				};

				const ping = new PingCommand();

				const { emitChunks } = chunkObjectStream(rawOutput);
				const runPromise = ping.runTcp(fakeTcpHandler(emitChunks), mockedSocket as any, 'measurement', 'test', options);

				await runPromise;

				expect(mockedSocket.emit.callCount).to.equal(1);
				expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});
		}

		it(`should run and parse successful command without progress updates - ipv6-ping-success`, async () => {
			const testCase = 'ipv6-ping-success';
			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '2a00:1450:4026:808::200e',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 6 as const,
			};

			const mockedCmd = getExecaMock();

			const ping = new PingCommand();

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options, 'google.com');

			const { emitChunks } = chunkOutput(rawOutput);

			await emitChunks(mockedCmd.stdout);

			mockedCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it(`should run and parse successful command without progress updates - ipv6-ping-success-no-domain`, async () => {
			const testCase = 'ipv6-ping-success-no-domain';
			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '2606:4700:4700::1111',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 6 as const,
			};

			const mockedCmd = getExecaMock();

			const ping = new PingCommand();

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options, '2606:4700:4700::1111');

			const { emitChunks } = chunkOutput(rawOutput);

			await emitChunks(mockedCmd.stdout);

			mockedCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and fail private ip command on the progress step (TCP)', async () => {
			const command = 'ping-private-ip-linux-tcp';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: 'google.com',
				packets: 3,
				protocol: 'TCP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};

			const ping = new PingCommand();

			const { emitChunks } = chunkObjectStream(rawOutput);
			const runPromise = ping.runTcp(fakeTcpHandler(emitChunks), mockedSocket as any, 'measurement', 'test', options);

			await runPromise;

			expect((mockedSocket.emit.firstCall.args[1] as any).result.rawOutput).to.include('Private IP');
			expect(mockedSocket.emit.secondCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and fail private ip command on the result step if progress updates are disabled (TCP)', async () => {
			const command = 'ping-private-ip-linux-tcp';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: 'google.com',
				packets: 3,
				protocol: 'TCP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};

			const ping = new PingCommand();

			const { emitChunks } = chunkObjectStream(rawOutput);
			const runPromise = ping.runTcp(fakeTcpHandler(emitChunks), mockedSocket as any, 'measurement', 'test', options);

			await runPromise;

			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		const failedCommands = [{ command: 'ping-timeout-linux', address: '123.21.43.124' }];

		for (const { command, address } of failedCommands) {
			it(`should run and parse failed commands - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
					timeout: 5,
					target: address,
					packets: 3,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: true,
					ipVersion: 4 as const,
				};

				const execaError = execaSync('unknown-command', [], { reject: false });
				execaError.stdout = rawOutput;
				const mockedCmd = getExecaMock();

				const ping = new PingCommand();
				const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);
				mockedCmd.reject(execaError);
				await runPromise;

				expect(mockedSocket.emit.calledOnce).to.be.true;
				expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
				expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
			});
		}

		it(`should run and parse results with timeouts`, async () => {
			const command = 'ping-slow-linux';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '172.217.20.206',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};

			const execaError = execaSync('unknown-command', [], { reject: false });
			execaError.stdout = rawOutput;
			const mockedCmd = getExecaMock();

			const ping = new PingCommand();
			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options, 'google.com');
			mockedCmd.reject(execaError);
			await runPromise;

			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should fail in case of output without header', async () => {
			const mockedCmd = getExecaMock();
			const ping = new PingCommand();
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '1.1.1.1',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);
			mockedCmd.resolve({ stdout: '' });
			await runPromise;

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'failed',
					failureSource: 'internal',
					rawOutput: '',
					resolvedAddress: '1.1.1.1',
					resolvedHostname: '1.1.1.1',
					timings: [],
					stats: { min: null, max: null, avg: null, total: null, loss: null, rcv: null, drop: null },
				},
			}]);
		});

		it('should classify an execa timeout after receiving replies as internal', async () => {
			const mockedCmd = getExecaMock();
			const ping = new PingCommand();
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '172.217.20.206',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options, 'lhr25s33-in-f14.1e100.net');
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.timedOut = true;

			timeoutError.stdout = 'PING 172.217.20.206 (172.217.20.206) 56(84) bytes of data.\n'
				+ '64 bytes from 172.217.20.206: icmp_seq=1 ttl=37 time=7.99 ms\n'
				+ '64 bytes from 172.217.20.206: icmp_seq=2 ttl=37 time=8.12 ms';

			mockedCmd.reject(timeoutError);
			await runPromise;

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([
				'probe:measurement:result',
				{
					testId: 'test',
					measurementId: 'measurement',
					result: {
						status: 'failed',
						failureSource: 'internal',
						rawOutput: 'PING lhr25s33-in-f14.1e100.net (172.217.20.206) 56(84) bytes of data.\n'
							+ '64 bytes from lhr25s33-in-f14.1e100.net (172.217.20.206): icmp_seq=1 ttl=37 time=7.99 ms\n'
							+ '64 bytes from lhr25s33-in-f14.1e100.net (172.217.20.206): icmp_seq=2 ttl=37 time=8.12 ms\n'
							+ '\n'
							+ 'The measurement command timed out.',
						resolvedAddress: '172.217.20.206',
						resolvedHostname: 'lhr25s33-in-f14.1e100.net',
						timings: [{ ttl: 37, rtt: 7.99 }, { ttl: 37, rtt: 8.12 }],
						stats: {
							min: null,
							max: null,
							avg: null,
							total: 0,
							loss: 0,
							rcv: 0,
							drop: 0,
						},
					},
				},
			]);
		});

		it('should classify an execa timeout after emitting only the header as internal', async () => {
			const mockedCmd = getExecaMock();
			const ping = new PingCommand();
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '172.217.20.206',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};
			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.stdout = 'PING 172.217.20.206 (172.217.20.206) 56(84) bytes of data.';
			timeoutError.timedOut = true;
			mockedCmd.reject(timeoutError);

			await runPromise;

			const result = (mockedSocket.emit.lastCall.args[1] as any).result;
			expect(result.failureSource).to.equal('internal');
			expect(result.resolvedAddress).to.equal('172.217.20.206');
		});

		it('should classify an execa timeout after ping reports no answer as target', async () => {
			const mockedCmd = getExecaMock();
			const ping = new PingCommand();
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '172.217.20.206',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};
			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.stdout = 'PING 172.217.20.206 (172.217.20.206) 56(84) bytes of data.\nno answer yet for icmp_seq=1';
			timeoutError.timedOut = true;
			mockedCmd.reject(timeoutError);

			await runPromise;

			expect((mockedSocket.emit.firstCall.args[1] as any).result.failureSource).to.equal('target');
		});

		it('should classify an execa timeout with invalid output as internal', async () => {
			const mockedCmd = getExecaMock();
			const ping = new PingCommand();
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '172.217.20.206',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};
			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.stdout = 'invalid partial output';
			timeoutError.timedOut = true;
			mockedCmd.reject(timeoutError);

			await runPromise;

			const result = (mockedSocket.emit.lastCall.args[1] as any).result;
			expect(result.failureSource).to.equal('internal');
			expect(result.resolvedAddress).to.equal('172.217.20.206');
		});

		it('should not prepend blank lines to a timeout without command output', async () => {
			const mockedCmd = getExecaMock();
			const ping = new PingCommand();
			const options = {
				type: 'ping' as PingOptions['type'],
				timeout: 5,
				target: '172.217.20.206',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};
			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.stdout = '';
			timeoutError.timedOut = true;
			mockedCmd.reject(timeoutError);

			await runPromise;

			const result = (mockedSocket.emit.lastCall.args[1] as any).result;
			expect(result.failureSource).to.equal('internal');
			expect(result.rawOutput).to.equal('The measurement command timed out.');
		});

		it('should reject private target on validation', async () => {
			try {
				await new PingCommand().run(mockedSocket as any, 'measurement', 'test', {
					type: 'ping',
					timeout: 5,
					target: '127.0.0.1',
					packets: 1,
					protocol: 'ICMP',
					port: 80,
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
