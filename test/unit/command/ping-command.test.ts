import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import { type ExecaError, execaSync } from 'execa';
import { chunkObjectStream, chunkOutput, getCmdMock, getCmdMockResult, getExecaMock } from '../../utils.js';
import { toRawTcpOutput } from '../../../src/command/handlers/ping/tcp-ping.js';
import {
	PingCommand,
	argBuilder,
	type PingOptions,
} from '../../../src/command/ping-command.js';

describe('ping command executor', () => {
	describe('argument builder (ICMP)', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'ping' as PingOptions['type'],
				target: 'google.com',
				packets: 1,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};

			const args = argBuilder(options);
			const joinedArgs = args.join(' ');

			expect(args[0]).to.equal('-4');
			expect(args[1]).to.equal('-O');
			expect(args[args.length - 1]).to.equal(options.target);
			expect(joinedArgs).to.contain(`-c ${options.packets}`);
			expect(joinedArgs).to.contain('-i 0.5');
			expect(joinedArgs).to.contain('-w 10');
		});

		describe('ipVersion', () => {
			it('should set -4 flag', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
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

		const successfulCommands = [ 'ping-success-linux', 'ping-success-linux-no-domain', 'ping-no-source-ip-linux', 'ping-unreachable-linux' ];

		for (const command of successfulCommands) {
			it(`should run and parse successful commands - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
					target: 'google.com',
					packets: 3,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: true,
					ipVersion: 4 as const,
				};

				const mockedCmd = getExecaMock();

				const ping = new PingCommand();

				const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);

				const { emitChunks, verifyChunks } = chunkOutput(rawOutput);

				await emitChunks(mockedCmd.stdout);

				mockedCmd.resolve({ stdout: rawOutput });
				await runPromise;

				verifyChunks(mockedSocket);

				expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});
		}

		for (const command of successfulCommands) {
			it(`should run and parse successful commands without progress updates - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
					target: 'google.com',
					packets: 3,
					protocol: 'ICMP',
					port: 80,
					inProgressUpdates: false,
					ipVersion: 4 as const,
				};

				const mockedCmd = getExecaMock();

				const ping = new PingCommand();

				const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);

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

		for (const command of tcpCommands) {
			it(`should run and parse successful commands without progress updates - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
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
				target: 'google.com',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 6 as const,
			};

			const mockedCmd = getExecaMock();

			const ping = new PingCommand();

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);

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
				target: '2606:4700:4700::1111',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 6 as const,
			};

			const mockedCmd = getExecaMock();

			const ping = new PingCommand();

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);

			await emitChunks(mockedCmd.stdout);

			mockedCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and fail private ip command on the progress step', async () => {
			const command = 'ping-private-ip-linux';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);
			const options = {
				type: 'ping' as PingOptions['type'],
				target: 'google.com',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};

			const mockedCmd = getExecaMock();

			const ping = new PingCommand();

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockedCmd.stdout);

			mockedCmd.reject(new Error('KILL'));

			await runPromise;

			expect(mockedCmd.kill.called).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and fail private ip command on the progress step (TCP)', async () => {
			const command = 'ping-private-ip-linux-tcp';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);
			const options = {
				type: 'ping' as PingOptions['type'],
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

		it('should run and fail private ip command on the result step', async () => {
			const command = 'ping-private-ip-linux';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);
			const options = {
				type: 'ping' as PingOptions['type'],
				target: 'google.com',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};

			const mockedCmd = getExecaMock();


			const ping = new PingCommand();

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);
			mockedCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockedCmd.kill.called).to.be.false;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and fail private ip command on the result step if progress updates are disabled', async () => {
			const command = 'ping-private-ip-linux';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);
			const options = {
				type: 'ping' as PingOptions['type'],
				target: 'google.com',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: false,
				ipVersion: 4 as const,
			};

			const mockedCmd = getExecaMock();

			const ping = new PingCommand();

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockedCmd.stdout);

			mockedCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockedCmd.kill.called).to.be.false;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and fail private ip command on the result step if progress updates are disabled (TCP)', async () => {
			const command = 'ping-private-ip-linux-tcp';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);
			const options = {
				type: 'ping' as PingOptions['type'],
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

		const failedCommands = [ 'ping-timeout-linux' ];

		for (const command of failedCommands) {
			it(`should run and parse failed commands - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);
				const options = {
					type: 'ping' as PingOptions['type'],
					target: 'google.com',
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
				target: 'google.com',
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

		it('should fail in case of output without header', async () => {
			const mockedCmd = getExecaMock();
			const ping = new PingCommand();
			const options = {
				type: 'ping' as PingOptions['type'],
				target: 'google.com',
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
					rawOutput: '',
					resolvedAddress: null,
					resolvedHostname: null,
					timings: [],
					stats: { min: null, max: null, avg: null, total: null, loss: null, rcv: null, drop: null },
				},
			}]);
		});

		it('should fail in case of execa timeout', async () => {
			const mockedCmd = getExecaMock();
			const ping = new PingCommand();
			const options = {
				type: 'ping' as PingOptions['type'],
				target: 'google.com',
				packets: 3,
				protocol: 'ICMP',
				port: 80,
				inProgressUpdates: true,
				ipVersion: 4 as const,
			};

			const runPromise = ping.runIcmp((): any => mockedCmd, mockedSocket as any, 'measurement', 'test', options);
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.timedOut = true;

			timeoutError.stdout = 'PING google.com (172.217.20.206) 56(84) bytes of data.\n'
				+ '64 bytes from lhr25s33-in-f14.1e100.net (172.217.20.206): icmp_seq=1 ttl=37 time=7.99 ms\n'
				+ '64 bytes from lhr25s33-in-f14.1e100.net (172.217.20.206): icmp_seq=2 ttl=37 time=8.12 ms';

			mockedCmd.reject(timeoutError);
			await runPromise;

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([
				'probe:measurement:result',
				{
					testId: 'test',
					measurementId: 'measurement',
					result: {
						status: 'failed',
						rawOutput: 'PING google.com (172.217.20.206) 56(84) bytes of data.\n'
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

		it('should reject private target on validation', async () => {
			try {
				await new PingCommand().run(mockedSocket as any, 'measurement', 'test', {
					type: 'ping',
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
