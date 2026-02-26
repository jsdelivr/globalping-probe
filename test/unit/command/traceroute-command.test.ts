import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import { type ExecaError } from 'execa';
import { chunkOutput, getCmdMock, getCmdMockResult, getExecaMock } from '../../utils.js';
import {
	TracerouteCommand,
	argBuilder,
	type TraceOptions,
} from '../../../src/command/traceroute-command.js';

describe('trace command', () => {
	describe('argument builder', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'traceroute' as TraceOptions['type'],
				target: 'google.com',
				port: 80,
				protocol: 'TCP',
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const args = argBuilder(options);
			const joinedArgs = args.join(' ');

			expect(args[0]).to.equal('-4');
			expect(args[args.length - 1]).to.equal(options.target);
			expect(joinedArgs).to.contain('-m 20');
			expect(joinedArgs).to.contain('-N 20');
			expect(joinedArgs).to.contain('-w 2');
			expect(joinedArgs).to.contain('-q 2');
			expect(joinedArgs).to.contain(`--${options.protocol.toLowerCase()}`);
			expect(joinedArgs).to.contain(`-p ${options.port}`);
		});

		describe('ipVersion', () => {
			it('should set -4 flag', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 80,
					protocol: 'TCP',
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args[0]).to.equal('-4');
			});

			it('should set -6 flag', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 80,
					protocol: 'TCP',
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const args = argBuilder(options);
				expect(args[0]).to.equal('-6');
			});
		});

		describe('port', () => {
			it('should set -p 90 flag (TCP)', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
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

	describe('command handler', () => {
		const sandbox = sinon.createSandbox();
		const mockSocket = sandbox.createStubInstance(Socket);

		beforeEach(() => {
			sandbox.reset();
		});

		describe('mock', () => {
			it('should run and parse trace with progress messages', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
					ipVersion: 4,
				};

				const testCase = 'trace-success-linux';
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const { lines, emitChunks, verifyChunks } = chunkOutput(rawOutput);

				await emitChunks(mockCmd.stdout);

				mockCmd.resolve({ stdout: rawOutput });
				await runPromise;

				verifyChunks(mockSocket, lines.map(line => line.replace('192.168.0.1', '_gateway')));

				expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should run and parse trace', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const testCase = 'trace-success-linux';
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
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
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const testCase = 'ipv6-trace-success';
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
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
					target: '2a00:1450:4026:808::200f',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const testCase = 'ipv6-trace-success-ip';
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const { emitChunks } = chunkOutput(rawOutput);

				await emitChunks(mockCmd.stdout);

				mockCmd.resolve({ stdout: rawOutput });
				await runPromise;

				expect(mockSocket.emit.callCount).to.equal(1);
				expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should run and parse private ip trace on progress step', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
					ipVersion: 4,
				};

				const testCase = 'trace-private-ip-linux';
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const { emitChunks } = chunkOutput(rawOutput);
				await emitChunks(mockCmd.stdout);

				mockCmd.reject(new Error('KILL'));
				await runPromise;

				expect(mockCmd.kill.called).to.be.true;
				expect(mockSocket.emit.calledOnce).to.be.true;
				expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should run and parse private ip trace on result step', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
					ipVersion: 4,
				};

				const testCase = 'trace-private-ip-linux';
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				mockCmd.resolve({ stdout: rawOutput });
				await runPromise;

				expect(mockSocket.emit.calledOnce).to.be.true;
				expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should run and parse private ip trace on result step without progress messages', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
					ipVersion: 4,
				};

				const testCase = 'trace-private-ip-linux';
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const { emitChunks } = chunkOutput(rawOutput);
				await emitChunks(mockCmd.stdout);

				mockCmd.reject({ stdout: rawOutput });
				await runPromise;

				expect(mockSocket.emit.calledOnce).to.be.true;
				expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
			});

			it('should fail in case of execa timeout', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
					ipVersion: 4,
				};
				const mockCmd = getExecaMock();
				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				const timeoutError = new Error('Timeout') as ExecaError;
				timeoutError.stderr = '';
				timeoutError.timedOut = true;
				timeoutError.stdout = 'traceroute to hello.com (216.239.38.21), 20 hops max, 60 byte packets';
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
							rawOutput: 'traceroute to hello.com (216.239.38.21), 20 hops max, 60 byte packets\n'
								+ '\n'
								+ 'The measurement command timed out.',
						},
					},
				]);
			});

			it('should reject private target on validation', async () => {
				try {
					await new TracerouteCommand((() => {
						throw new Error('should not be called');
					}) as any).run(mockSocket as any, 'measurement', 'test', {
						type: 'traceroute',
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
