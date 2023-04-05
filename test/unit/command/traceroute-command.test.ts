import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult, getExecaMock} from '../../utils.js';
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

		describe('port', () => {
			it('should set -p 90 flag (TCP)', () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 90,
					protocol: 'TCP',
					inProgressUpdates: false,
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
			it('should run and parse trace', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
				};

				const testCase = 'trace-success-linux';
				const rawOutput = getCmdMock(testCase);
				const outputProgress = rawOutput.split('\n');
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);
				for (const progressOutput of outputProgress) {
					mockCmd.stdout.emit('data', Buffer.from(progressOutput, 'utf8'));
				}

				mockCmd.resolve({stdout: rawOutput});
				await runPromise;

				expect(mockSocket.emit.callCount).to.equal(2);
				expect(mockSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:progress', {
					testId: 'test',
					measurementId: 'measurement',
					result: {
						rawOutput: outputProgress[0],
					},
				}]);
				expect(mockSocket.emit.lastCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
			});

			it('should run and parse trace without progress messages', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: false,
				};

				const testCase = 'trace-success-linux';
				const rawOutput = getCmdMock(testCase);
				const outputProgress = rawOutput.split('\n');
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);
				for (const progressOutput of outputProgress) {
					mockCmd.stdout.emit('data', Buffer.from(progressOutput, 'utf8'));
				}

				mockCmd.resolve({stdout: rawOutput});
				await runPromise;

				expect(mockSocket.emit.callCount).to.equal(1);
				expect(mockSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
			});

			it('should run and parse private ip trace on progress step', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
				};

				const testCase = 'trace-private-ip-linux';
				const rawOutput = getCmdMock(testCase);
				const outputProgress = rawOutput.split('\n');
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);
				for (const progressOutput of outputProgress) {
					mockCmd.stdout.emit('data', Buffer.from(progressOutput, 'utf8'));
				}

				mockCmd.reject(new Error('KILL'));
				await runPromise;

				expect(mockCmd.kill.called).to.be.true;
				expect(mockSocket.emit.calledOnce).to.be.true;
				expect(mockSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
			});

			it('should run and parse private ip trace on result step', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
				};

				const testCase = 'trace-private-ip-linux';
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);

				mockCmd.resolve({stdout: rawOutput});
				await runPromise;

				expect(mockSocket.emit.calledOnce).to.be.true;
				expect(mockSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
			});

			it('should run and parse private ip trace on result step without progress messages', async () => {
				const options = {
					type: 'traceroute' as TraceOptions['type'],
					target: 'google.com',
					port: 53,
					protocol: 'UDP',
					inProgressUpdates: true,
				};

				const testCase = 'trace-private-ip-linux';
				const rawOutput = getCmdMock(testCase);
				const outputProgress = rawOutput.split('\n');
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = getExecaMock();

				const ping = new TracerouteCommand((): any => mockCmd);
				const runPromise = ping.run(mockSocket as any, 'measurement', 'test', options);
				for (const progressOutput of outputProgress) {
					mockCmd.stdout.emit('data', Buffer.from(progressOutput, 'utf8'));
				}

				mockCmd.reject({stdout: rawOutput});
				await runPromise;

				expect(mockSocket.emit.calledOnce).to.be.true;
				expect(mockSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
			});
		});
	});
});
