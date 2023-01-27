import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult, getExecaMock} from '../../utils.js';
import {
	MtrCommand,
	argBuilder,
	type MtrOptions,
} from '../../../src/command/mtr-command.js';

const dnsResolver = (isPrivate: boolean) => async (_addr: string, type = 'A') => {
	if (type === 'TXT') {
		return ['123 | abc | abc'];
	}

	if (isPrivate) {
		return ['192.168.0.1'];
	}

	return ['1.1.1.1'];
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

		describe('protocol', () => {
			it('should set --udp flag (UDP)', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					target: 'google.com',
					protocol: 'udp',
					port: 80,
					packets: 1,
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

		it('should run and parse mtr', async () => {
			const testCase = 'mtr-success-raw';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
			};

			const expectedResult = getCmdMockResult(testCase);
			const rawOutput = getCmdMock(testCase);
			const rawOutputLines = rawOutput.split('\n');
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver(false));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);
			for (const progressOutput of rawOutputLines) {
				mockCmd.stdout.emit('data', Buffer.from(progressOutput, 'utf8'));
			}

			mockCmd.resolve(rawOutput);
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(2);
			expect(mockedSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:progress', {
				measurementId: 'measurement',
				overwrite: true,
				result: {
					hops: [{
						asn: [],
						stats: {
							avg: 0,
							drop: 0,
							jAvg: 0,
							jMax: 0,
							jMin: 0,
							max: 0,
							min: 0,
							rcv: 0,
							stDev: 0,
							total: 0,
						},
						timings: [{rtt: null, seq: '33000'}],
					}],
					rawOutput: 'Host          Loss% Drop Rcv Avg  StDev  Javg \n',
				},
				testId: 'test',
			}]);
			expect(mockedSocket.emit.lastCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
		});

		it('should detect Private IP and stop', async () => {
			const testCase = 'mtr-fail-private-ip';
			const options = {
				type: 'mtr' as const,
				target: 'jsdelivr.net',
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
	});
});
