import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult} from '../../utils.js';
import {
	TracerouteCommand,
	argBuilder,
} from '../../../src/command/traceroute-command.js';
import type {TraceOptions} from '../../../src/command/traceroute-command.js';

describe('trace command', () => {
	describe('argument builder', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'traceroute' as TraceOptions['type'],
				target: 'google.com',
				port: 80,
				protocol: 'TCP',
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
			const testCases = ['trace-success-linux', 'trace-private-ip-linux'];

			for (const testCase of testCases) {
				it(`should run and parse trace - ${testCase}`, async () => {
					const options = {
						target: 'google.com',
						port: 53,
						protocol: 'UDP',
					};

					const rawOutput = getCmdMock(testCase);
					const expectedResult = getCmdMockResult(testCase);

					const mockCmd = Promise.resolve({stdout: rawOutput});

					const ping = new TracerouteCommand((): any => mockCmd);
					await ping.run(mockSocket as any, 'measurement', 'test', options);

					expect(mockSocket.emit.calledOnce).to.be.true;
					expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
					expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
				});
			}
		});
	});
});
