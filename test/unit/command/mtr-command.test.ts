import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import { type ExecaError } from 'execa';
import { chunkOutput, getCmdMock, getCmdMockResult, getExecaMock } from '../../utils.js';
import {
	MtrCommand,
	argBuilder,
	type MtrOptions,
} from '../../../src/command/mtr-command.js';

const dnsResolver = (isPrivate: boolean, isIPv6?: boolean) => async (_addr: string, type = 'A') => {
	if (type === 'TXT') {
		return [ '123 | abc | abc' ];
	}

	if (isPrivate) {
		return [ '192.168.0.1' ];
	}

	if (isIPv6) {
		return [ '64:ff9b:1::1a2b:3c4d' ];
	}

	return [ '1.1.1.1' ];
};

describe('mtr command executor', () => {
	describe('argument builder', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'mtr' as MtrOptions['type'],
				target: 'google.com',
				protocol: 'tcp',
				port: 80,
				packets: 1,
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const args = argBuilder(options);
			const joinedArgs = args.join(' ');

			expect(args[0]).to.equal('-4');
			expect(args[args.length - 1]).to.equal(options.target);
			expect(args).to.contain('--tcp');
			expect(args).to.contain('--raw');
			expect(joinedArgs).to.contain('--interval 0.5');
			expect(joinedArgs).to.contain('--gracetime 3');
			expect(joinedArgs).to.contain('--max-ttl 30');
			expect(joinedArgs).to.contain(`-c ${options.packets}`);
			expect(joinedArgs).to.contain(`-P ${options.port}`);
		});

		describe('ipVersion', () => {
			it('should set -4 flag', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'tcp',
					port: 80,
					packets: 1,
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args[0]).to.equal('-4');
			});

			it('should set -6 flag', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'tcp',
					port: 80,
					packets: 1,
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const args = argBuilder(options);
				expect(args[0]).to.equal('-6');
			});
		});

		describe('protocol', () => {
			it('should set --udp flag (UDP)', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'udp',
					port: 80,
					packets: 1,
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args).to.contain('--udp');
			});

			it('should set --udp flag (TCP)', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'tcp',
					port: 80,
					packets: 1,
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args).to.contain('--tcp');
			});

			it('should not set any protocol flag (ICMP)', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'icmp',
					port: 80,
					packets: 1,
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args).to.not.contain('icmp');
			});
		});

		describe('port', () => {
			it('should set -p 90 flag', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'icmp',
					port: 90,
					packets: 1,
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args.join(' ')).to.contain('-P 90');
			});
		});

		describe('packets', () => {
			it('should set -c 2 flag', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'icmp',
					port: 90,
					packets: 2,
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain('-c 2');
			});

			it('should set -c 5 flag', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'icmp',
					port: 90,
					packets: 5,
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain('-c 5');
			});
		});
	});

	describe('command handler', () => {
		const sandbox = sinon.createSandbox();
		const mockedSocket = sandbox.createStubInstance(Socket);

		beforeEach(() => {
			sandbox.reset();
		});

		it('should run and parse mtr with progress messages', async () => {
			const testCase = 'mtr-success-raw';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const expectedResult = getCmdMockResult(testCase);
			const rawOutput = getCmdMock(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(false));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const { lines, emitChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(lines.length + 1);

			expect(mockedSocket.emit.args[0][1]).to.deep.include({
				overwrite: true,
				result: {
					rawOutput: 'Host          Loss% Drop Rcv Avg  StDev  Javg \n',
				},
			});

			expect(mockedSocket.emit.args[1][1]).to.deep.include({
				overwrite: true,
				result: {
					rawOutput: 'Host                              Loss% Drop Rcv Avg  StDev  Javg \n1. AS??? _gateway (192.168.0.1)       0.0%    0   0 0.0    0.0   0.0\n2. AS??? (waiting for reply)       \n',
				},
			});

			expect(mockedSocket.emit.args[8][1]).to.deep.include({
				overwrite: true,
				result: {
					rawOutput: 'Host                                                   Loss% Drop Rcv  Avg  StDev  Javg \n1. AS??? _gateway (192.168.0.1)                         0.0%    0   1  0.0    0.0   0.0\n2. AS??? (waiting for reply)                         \n3. AS123 62.252.67.181 (62.252.67.181)                  0.0%    0   1  9.8    0.6   1.2\n4. AS??? (waiting for reply)                         \n5. AS123 62.254.59.130 (62.254.59.130)                  0.0%    0   1 11.4    0.6   1.3\n6. AS123 142.250.160.116 (142.250.160.116)              0.0%    0   0 10.9    0.0  10.9\n7. AS123 216.239.41.193 (216.239.41.193)                0.0%    0   0 15.8    0.0  15.8\n8. AS123 142.251.54.27 (142.251.54.27)                  0.0%    0   0 15.7    0.0  15.7\n9. AS123 lhr25s31-in-f14.1e100.net (142.250.179.238)    0.0%    0   0 11.8    0.0  11.8\n',
				},
			});

			expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and parse mtr', async () => {
			const testCase = 'mtr-success-raw';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const expectedResult = getCmdMockResult(testCase);
			const rawOutput = getCmdMock(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(false));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve(rawOutput);
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and parse mtr - ipv6-mtr-success-raw', async () => {
			const testCase = 'ipv6-mtr-success-raw';
			const options = {
				type: 'mtr' as const,
				target: 'google.com',
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const expectedResult = getCmdMockResult(testCase);
			const rawOutput = getCmdMock(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(false));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve(rawOutput);
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should run and parse mtr - ipv6-mtr-success-ip', async () => {
			const testCase = 'ipv6-mtr-success-ip';
			const options = {
				type: 'mtr' as const,
				target: '2a00:1450:4026:808::200f',
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const expectedResult = getCmdMockResult(testCase);
			const rawOutput = getCmdMock(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(false));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve(rawOutput);
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should detect Private IPv4 and stop with progress messages', async () => {
			const testCase = 'mtr-fail-private-ip';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const expectedResult = getCmdMockResult(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(true));
			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(mockCmd.kill.called).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should detect Private IPv6 and stop with progress messages', async () => {
			const testCase = 'mtr-fail-private-ip';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: true,
				ipVersion: 6,
			};

			const expectedResult = getCmdMockResult(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(true, true));
			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(mockCmd.kill.called).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should detect Private IPv4 and stop', async () => {
			const testCase = 'mtr-fail-private-ip';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const expectedResult = getCmdMockResult(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(true));
			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(mockCmd.kill.called).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should detect Private IPv6 and stop', async () => {
			const testCase = 'mtr-fail-private-ip';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const expectedResult = getCmdMockResult(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(true, true));
			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(mockCmd.kill.called).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should detect private destination when second resolved ip is private', async () => {
			const testCase = 'mtr-fail-private-ip';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const expectedResult = getCmdMockResult(testCase);
			const mockCmd = getExecaMock();
			const mixedResolver = async () => {
				return [ '1.1.1.1', '192.168.0.1' ];
			};

			const mtr = new MtrCommand((): any => mockCmd, mixedResolver);
			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(mockCmd.kill.called).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should fail on post-check when parsed resolvedAddress is private', async () => {
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(false));
			sandbox.stub(mtr, 'parseResult').resolves({
				status: 'finished',
				rawOutput: 'raw output',
				hops: [],
				data: [],
				resolvedAddress: '192.168.0.1',
				resolvedHostname: null,
			} as any);

			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);
			mockCmd.resolve({ stdout: '' });
			await runPromise;

			expect(mockedSocket.emit.calledOnce).to.be.true;

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([
				'probe:measurement:result',
				{
					testId: 'test',
					measurementId: 'measurement',
					result: {
						status: 'failed',
						rawOutput: 'Private IP ranges are not allowed.',
						resolvedAddress: null,
						resolvedHostname: null,
						hops: [],
					},
				},
			]);
		});

		it('should fail in case of execa timeout', async () => {
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const mockCmd = getExecaMock();
			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(false));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.timedOut = true;

			timeoutError.stdout = 'x 0 33000\n'
				+ 'h 0 192.168.0.1\n'
				+ 'd 0 192.168.0.1\n'
				+ 'p 0 0 33000\n'
				+ 'x 1 33001\n'
				+ 'x 2 33002\n'
				+ 'h 2 62.252.67.181\n'
				+ 'd 2 62.252.67.181';

			mockCmd.reject(timeoutError);

			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([
				'probe:measurement:result',
				{
					testId: 'test',
					measurementId: 'measurement',
					result: {
						status: 'failed',
						rawOutput: 'x 0 33000\n'
							+ 'h 0 192.168.0.1\n'
							+ 'd 0 192.168.0.1\n'
							+ 'p 0 0 33000\n'
							+ 'x 1 33001\n'
							+ 'x 2 33002\n'
							+ 'h 2 62.252.67.181\n'
							+ 'd 2 62.252.67.181\n'
							+ '\n'
							+ 'The measurement command timed out.',
						resolvedAddress: null,
						resolvedHostname: null,
						hops: [],
					},
				},
			]);
		});

		it('should reject private target on validation', async () => {
			try {
				await new MtrCommand((() => {
					throw new Error('should not be called');
				}) as any, dnsResolver(false)).run(mockedSocket as any, 'measurement', 'test', {
					type: 'mtr',
					target: '127.0.0.1',
					protocol: 'icmp',
					port: 80,
					packets: 1,
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
