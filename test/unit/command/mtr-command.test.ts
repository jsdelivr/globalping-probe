import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import { type ExecaError } from 'execa';
import { chunkOutput, getCmdMock, getCmdMockResult, getExecaMock } from '../../utils.js';
import { clearDnsCache, cachedDnsLookupOne } from '../../../src/lib/dns.js';
import { InternalError } from '../../../src/lib/internal-error.js';
import {
	MtrCommand,
	argBuilder,
	type MtrOptions,
} from '../../../src/command/mtr-command.js';
import MtrParser from '../../../src/command/handlers/mtr/parser.js';

const dnsResolver = (result?: string | Error): typeof cachedDnsLookupOne => (async (_hostname: string, options: any) => {
	if (options.rrtype === 'PTR') {
		throw new Error('ENODATA');
	}

	if (options.rrtype === 'TXT') {
		return '123 | abc | abc';
	}

	if (result instanceof Error) {
		throw result;
	}

	return result;
}) as typeof cachedDnsLookupOne;

describe('mtr command executor', () => {
	describe('argument builder', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'mtr' as MtrOptions['type'],
				timeout: 5,
				target: 'google.com',
				protocol: 'tcp',
				port: 80,
				packets: 3,
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const args = argBuilder(options);
			const joinedArgs = args.join(' ');

			expect(args).to.contain('-4');
			expect(args[args.length - 1]).to.equal(options.target);
			expect(args).to.contain('--tcp');
			expect(args).to.contain('--raw');
			expect(args).to.contain('-n');
			expect(joinedArgs).to.contain('--interval 0.2');
			expect(joinedArgs).to.contain('--gracetime 2.4');
			expect(joinedArgs).to.contain('--max-ttl 30');
			expect(joinedArgs).to.contain(`-c ${options.packets}`);
			expect(joinedArgs).to.contain(`-P ${options.port}`);
		});

		for (const { packets, timeout, interval, grace, remaining } of [
			{ packets: 3, timeout: 10, interval: 0.5, grace: 4.5, remaining: 5 },
			{ packets: 16, timeout: 5, interval: 0.2, grace: 0.8, remaining: 1 },
			{ packets: 16, timeout: 10, interval: 0.33, grace: 2.67, remaining: 3 },
			{ packets: 16, timeout: 16, interval: 0.5, grace: 4.5, remaining: 5 },
		]) {
			it(`should fit ${packets} packets into a ${timeout} second budget`, () => {
				const args = argBuilder({
					type: 'mtr',
					timeout,
					target: 'google.com',
					protocol: 'tcp',
					port: 80,
					packets,
					inProgressUpdates: false,
					ipVersion: 4,
				});

				expect(args[args.indexOf('--interval') + 1]).to.equal(String(interval));
				expect(args[args.indexOf('--gracetime') + 1]).to.equal(String(grace));
				expect(args[args.indexOf('--timeout') + 1]).to.equal(String(remaining));
			});
		}

		it('should keep native arguments within every supported budget', () => {
			for (let timeout = 5; timeout <= 30; timeout++) {
				for (let packets = 1; packets <= 16; packets++) {
					const args = argBuilder({
						type: 'mtr',
						timeout,
						target: 'google.com',
						protocol: 'tcp',
						port: 80,
						packets,
						inProgressUpdates: false,
						ipVersion: 4,
					});
					const interval = Number(args[args.indexOf('--interval') + 1]);
					const grace = Number(args[args.indexOf('--gracetime') + 1]);
					const remaining = Number(args[args.indexOf('--timeout') + 1]);

					expect(interval).to.be.within(0.2, 1);
					expect(grace).to.be.within(0.5, 5);
					expect(remaining).to.be.at.least(1);
					expect(Number.isInteger(remaining)).to.equal(true);
					expect(packets * interval + grace).to.be.at.most(timeout + 1e-9);
				}
			}
		});

		describe('ipVersion', () => {
			it('should set -4 flag', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					timeout: 5,
					target: 'google.com',
					protocol: 'tcp',
					port: 80,
					packets: 1,
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args).to.contain('-4');
			});

			it('should set -6 flag', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					timeout: 5,
					target: 'google.com',
					protocol: 'tcp',
					port: 80,
					packets: 1,
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const args = argBuilder(options);
				expect(args).to.contain('-6');
			});
		});

		describe('protocol', () => {
			it('should set --udp flag (UDP)', () => {
				const options = {
					type: 'mtr' as MtrOptions['type'],
					timeout: 5,
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
					timeout: 5,
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
					timeout: 5,
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
					timeout: 5,
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
					timeout: 5,
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
					timeout: 5,
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
			clearDnsCache();
		});

		it('should stop target lookup at the static DNS deadline', async () => {
			const clock = sandbox.useFakeTimers();
			const lookupController = new AbortController();
			const timeoutStub = sandbox.stub(AbortSignal, 'timeout').returns(lookupController.signal);
			const cmdFn = sandbox.spy((): any => getExecaMock());
			const lookup = ((_hostname: string, options: any) => new Promise((_resolve, reject) => {
				options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
			})) as typeof cachedDnsLookupOne;
			const mtr = new MtrCommand(cmdFn, lookup);
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', {
				type: 'mtr', timeout: 10, target: 'jsdelivr.net', protocol: 'icmp', port: 80, packets: 3, inProgressUpdates: false, ipVersion: 4,
			});

			await clock.tickAsync(0);
			expect(mockedSocket.emit.notCalled).to.be.true;

			lookupController.abort();
			await runPromise;
			const usedStaticDeadline = timeoutStub.calledWith(4000);
			const commandWasNotCalled = cmdFn.notCalled;
			timeoutStub.restore();
			clock.restore();

			expect(usedStaticDeadline).to.be.true;
			expect(commandWasNotCalled).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;

			expect((mockedSocket.emit.firstCall.args[1] as any).result).to.include({
				status: 'failed',
				failureSource: 'resolver',
				rawOutput: 'The measurement command timed out.',
			});
		});

		it('should preserve static MTR arguments after target lookup', async () => {
			const clock = sandbox.useFakeTimers();
			const mockCmd = getExecaMock();
			let passedArgs: string[] = [];
			let passedProcessTimeout: number | undefined;
			const cmdFn = (cmdOptions: MtrOptions, processTimeout?: number): any => {
				passedArgs = argBuilder(cmdOptions);
				passedProcessTimeout = processTimeout;
				return mockCmd;
			};
			const lookup = (async (_hostname: string, options: any) => {
				if (options.rrtype) {
					return '123 | abc | abc';
				}

				return new Promise(resolve => setTimeout(() => resolve('1.1.1.1'), 2900));
			}) as typeof cachedDnsLookupOne;
			const mtr = new MtrCommand(cmdFn, lookup);
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', {
				type: 'mtr', timeout: 10, target: 'jsdelivr.net', protocol: 'icmp', port: 80, packets: 3, inProgressUpdates: false, ipVersion: 4,
			});

			await clock.tickAsync(2900);

			expect(passedArgs[passedArgs.indexOf('--interval') + 1]).to.equal('0.5');
			expect(passedArgs[passedArgs.indexOf('--gracetime') + 1]).to.equal('4.5');
			expect(passedProcessTimeout).to.equal(9100);

			mockCmd.resolve({ stdout: '' });
			await runPromise;
			clock.restore();
		});

		it('should enrich progress with ready values without waiting and wait for final enrichment', async () => {
			const rawOutput = getCmdMock('mtr-success-raw').split('\n').filter(line => !line.startsWith('d ')).join('\n');
			const mockCmd = getExecaMock();
			const lookup = sandbox.stub();
			let resolvePtr!: (record: string) => void;
			let resolveAsn!: (record: string) => void;
			const ptrResult = new Promise<string>((resolve) => {
				resolvePtr = resolve;
			});
			const asnResult = new Promise<string>((resolve) => {
				resolveAsn = resolve;
			});
			lookup.callsFake((_hostname: string, options: any) => {
				if (!options.rrtype) {
					return Promise.resolve('142.250.179.238');
				}

				if (options.rrtype === 'PTR') {
					return ptrResult;
				}

				return asnResult;
			});

			const mtr = new MtrCommand((): any => mockCmd, lookup as typeof cachedDnsLookupOne);
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', {
				type: 'mtr', timeout: 10, target: 'example.com', protocol: 'icmp', port: 80, packets: 3, inProgressUpdates: true, ipVersion: 4,
			});

			await new Promise(resolve => setImmediate(resolve));
			mockCmd.stdout.write('x 0 0\nx 1 33000\nh 1 62.252.67.181\n');
			await new Promise(resolve => setTimeout(resolve, 150));
			const startedPtr = lookup.calledWithMatch('62.252.67.181', { rrtype: 'PTR' });
			const startedAsn = lookup.calledWithMatch('181.67.252.62.origin.asn.cymru.com', { rrtype: 'TXT' });
			const unresolvedProgress = (mockedSocket.emit.lastCall.args[1] as any).result.rawOutput;
			const progressCount = mockedSocket.emit.callCount;

			resolvePtr('ptr.example');
			await new Promise(resolve => setTimeout(resolve, 150));

			expect(mockedSocket.emit.callCount).to.equal(progressCount);

			mockCmd.stdout.write('p 1 10000 33000\n');
			await new Promise(resolve => setTimeout(resolve, 150));
			const partiallyEnrichedProgress = (mockedSocket.emit.lastCall.args[1] as any).result.rawOutput;
			let finished = false;
			void runPromise.then(() => {
				finished = true;
			});

			mockCmd.stdout.end(rawOutput);
			mockCmd.resolve({ stdout: rawOutput });
			await new Promise(resolve => setImmediate(resolve));

			expect(finished).to.be.false;

			resolveAsn('64500 64501 | example | example');
			const result = await runPromise as any;

			expect(startedPtr).to.be.true;
			expect(startedAsn).to.be.true;
			expect(unresolvedProgress).to.include('62.252.67.181 (62.252.67.181)');
			expect(unresolvedProgress).not.to.include('ptr.example');
			expect(partiallyEnrichedProgress).to.include('ptr.example (62.252.67.181)');
			expect(partiallyEnrichedProgress).to.include('AS???');
			expect(result.status).to.equal('finished');
			expect(result.hops.some((hop: any) => hop.resolvedHostname === 'ptr.example')).to.be.true;
			expect(result.hops.some((hop: any) => hop.asn.includes(64500) && hop.asn.includes(64501))).to.be.true;
		});

		it('should run and parse mtr with progress messages', async () => {
			const testCase = 'mtr-success-raw';
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'jsdelivr.net',
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const expectedResult = getCmdMockResult(testCase) as any;
			expectedResult.result.resolvedHostname = options.target;
			expectedResult.result.hops[0].resolvedHostname = '_gateway';
			const rawOutput = getCmdMock(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver('1.1.1.1'));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const { lines, emitChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(lines.length + 1);

			expect(mockedSocket.emit.args[0][1]).to.deep.include({
				overwrite: true,
				result: {
					rawOutput: 'Host                           Loss% Drop Rcv Avg  StDev  Javg \n1. AS??? (waiting for reply) \n',
				},
			});

			expect(mockedSocket.emit.args[1][1]).to.deep.include({
				overwrite: true,
				result: {
					rawOutput: 'Host                              Loss% Drop Rcv Avg  StDev  Javg \n1. AS??? _gateway (192.168.0.1)    0.0%    0   0 0.0    0.0   0.0\n2. AS??? (waiting for reply)    \n',
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

		it('should use the resolved target hostname when MTR does not reach the target', async () => {
			const testCase = 'mtr-success-raw';
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const expectedResult = getCmdMockResult(testCase) as any;
			expectedResult.result.resolvedHostname = options.target;
			expectedResult.result.hops[0].resolvedHostname = '_gateway';
			const rawOutput = getCmdMock(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver('1.1.1.1'));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve(rawOutput);
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should label the first responding hop as _gateway in raw and structured output', async () => {
			const rawOutput = getCmdMock('mtr-success-raw');
			const mockCmd = getExecaMock();
			const mtr = new MtrCommand((): any => mockCmd, dnsResolver('1.1.1.1'));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', {
				type: 'mtr', timeout: 5, target: 'jsdelivr.net', protocol: 'icmp', port: 80, packets: 3, inProgressUpdates: false, ipVersion: 4,
			});

			await new Promise(resolve => setImmediate(resolve));
			mockCmd.stdout.end(rawOutput);
			mockCmd.resolve({ stdout: rawOutput });
			const result = await runPromise as any;

			expect(result.rawOutput).to.include('_gateway (192.168.0.1)');
			expect(result.hops[0].resolvedHostname).to.equal('_gateway');
		});

		it('should pass the deadline signal to final ASN lookup', async () => {
			const rawOutput = getCmdMock('mtr-success-raw');
			const mockCmd = getExecaMock();
			let receivedSignal = false;
			const lookup = (async (_hostname: string, options: any) => {
				if (options.rrtype) {
					receivedSignal = options.signal instanceof AbortSignal;
					throw new Error('ASN lookup failed.');
				}

				return '1.1.1.1';
			}) as typeof cachedDnsLookupOne;
			const mtr = new MtrCommand((): any => mockCmd, lookup);
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', {
				type: 'mtr', timeout: 5, target: 'jsdelivr.net', protocol: 'icmp', port: 80, packets: 3, inProgressUpdates: false, ipVersion: 4,
			});
			await new Promise(resolve => setImmediate(resolve));
			mockCmd.stdout.end(rawOutput);
			mockCmd.resolve({ stdout: rawOutput });
			const result = await runPromise as any;

			expect(receivedSignal).to.be.true;
			expect(result.status).to.equal('finished');
			expect(result.hops).not.to.be.empty;
			expect(result.rawOutput).to.contain('Host');
		});

		it('should emit progress without waiting for enrichment', async () => {
			const mockCmd = getExecaMock();
			let resolvePtr!: (record: string) => void;
			let resolveAsn!: (record: string) => void;
			const ptrResult = new Promise<string>((resolve) => {
				resolvePtr = resolve;
			});
			const asnResult = new Promise<string>((resolve) => {
				resolveAsn = resolve;
			});
			const lookup = (async (_hostname: string, options: any) => {
				if (!options.rrtype) {
					return '1.1.1.1';
				}

				return options.rrtype === 'PTR' ? ptrResult : asnResult;
			}) as typeof cachedDnsLookupOne;
			const mtr = new MtrCommand((): any => mockCmd, lookup);
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', {
				type: 'mtr', timeout: 5, target: 'example.com', protocol: 'icmp', port: 80, packets: 3, inProgressUpdates: true, ipVersion: 4,
			});

			await new Promise(resolve => setImmediate(resolve));
			mockCmd.stdout.write('h 0 2.2.2.2\n');
			await new Promise(resolve => setImmediate(resolve));

			expect(mockedSocket.emit.calledWithMatch('probe:measurement:progress')).to.be.true;
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawOutput).to.include('_gateway (2.2.2.2)');

			resolvePtr('ptr.example');
			resolveAsn('64500 | example | example');
			mockCmd.stdout.end();
			mockCmd.resolve({ stdout: 'h 0 2.2.2.2\n' });
			await runPromise;
		});

		it('should run and parse mtr - ipv6-mtr-success-raw', async () => {
			const testCase = 'ipv6-mtr-success-raw';
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'google.com',
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const expectedResult = getCmdMockResult(testCase) as any;
			expectedResult.result.resolvedHostname = options.target;
			expectedResult.result.hops.at(-1).resolvedHostname = options.target;
			expectedResult.result.rawOutput = MtrParser.outputBuilder(expectedResult.result.hops);
			expectedResult.result.hops[0].resolvedHostname = '_gateway';
			const rawOutput = getCmdMock(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver('2a00:1450:4026:802::200e'));
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
				timeout: 5,
				target: '2a00:1450:4026:808::200f',
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const expectedResult = getCmdMockResult(testCase) as any;
			expectedResult.result.resolvedHostname = options.target;
			expectedResult.result.hops[0].resolvedHostname = '_gateway';
			const rawOutput = getCmdMock(testCase);
			const mockCmd = getExecaMock();

			const mtr = new MtrCommand((): any => mockCmd, dnsResolver());
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve(rawOutput);
			await runPromise;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should detect Private IP and stop with progress messages', async () => {
			const testCase = 'mtr-fail-private-ip';
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'jsdelivr.net',
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const expectedResult = getCmdMockResult(testCase);
			const cmdFn = sandbox.spy((): any => getExecaMock());

			const mtr = new MtrCommand(cmdFn, dnsResolver(new InternalError('Private IP ranges are not allowed.', true, 'target')));
			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(cmdFn.notCalled).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should detect Private IPv6 and stop', async () => {
			const testCase = 'mtr-fail-private-ip';
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const expectedResult = getCmdMockResult(testCase);
			const cmdFn = sandbox.spy((): any => getExecaMock());

			const mtr = new MtrCommand(cmdFn, dnsResolver(new InternalError('Private IP ranges are not allowed.', true, 'target')));
			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(cmdFn.notCalled).to.be.true;
			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should preserve target DNS failure classification', async () => {
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'missing.example',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const cmdFn = sandbox.spy((): any => getExecaMock());
			const mtr = new MtrCommand(cmdFn, dnsResolver(new InternalError('ENOTFOUND missing.example', true, 'target')));

			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(cmdFn.notCalled).to.be.true;
			expect((mockedSocket.emit.firstCall.args[1] as any).result.failureSource).to.equal('target');
		});

		it('should preserve resolver failure classification', async () => {
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'example.com',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const cmdFn = sandbox.spy((): any => getExecaMock());
			const mtr = new MtrCommand(cmdFn, dnsResolver(new InternalError('queryA ETIMEOUT example.com', true, 'resolver')));

			await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			expect(cmdFn.notCalled).to.be.true;
			expect((mockedSocket.emit.firstCall.args[1] as any).result.failureSource).to.equal('resolver');
		});

		it('should pass the first resolved ip to mtr as the target', async () => {
			const clock = sandbox.useFakeTimers();
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const mockCmd = getExecaMock();
			let passedTarget = '';
			let passedProcessTimeout: number | undefined;
			const cmdFn = (cmdOptions: MtrOptions, processTimeout?: number): any => {
				passedTarget = cmdOptions.target;
				passedProcessTimeout = processTimeout;
				return mockCmd;
			};
			const resolver = dnsResolver('1.1.1.1');

			const mtr = new MtrCommand(cmdFn, resolver);
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);
			mockCmd.resolve({ stdout: '' });
			await runPromise;

			expect(passedTarget).to.equal('1.1.1.1');
			expect(passedProcessTimeout).to.equal(7000);
			expect(mockCmd.kill.notCalled).to.be.true;
			clock.restore();
		});

		it('should fail in case of execa timeout', async () => {
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const mockCmd = getExecaMock();
			const mtr = new MtrCommand((): any => mockCmd, dnsResolver('1.1.1.1'));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.timedOut = true;

			timeoutError.stdout = 'x 0 33000\n'
				+ 'h 0 192.168.0.1\n'
				+ 'p 0 0 33000\n'
				+ 'x 1 33001\n'
				+ 'x 2 33002\n'
				+ 'h 2 62.252.67.181\n'
				+ 'p 2 10000 33002';

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
						failureSource: 'target',
						rawOutput: 'x 0 33000\n'
							+ 'h 0 192.168.0.1\n'
							+ 'p 0 0 33000\n'
							+ 'x 1 33001\n'
							+ 'x 2 33002\n'
							+ 'h 2 62.252.67.181\n'
							+ 'p 2 10000 33002\n'
							+ '\n'
							+ 'The measurement command timed out.',
						resolvedAddress: null,
						resolvedHostname: null,
						hops: [],
					},
				},
			]);
		});

		it('should classify an execa timeout after an equivalent IPv6 target responds before an unresolved hop as internal', async () => {
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: '2606:4700:4700:0000:0000:0000:0000:1111',
				inProgressUpdates: false,
				ipVersion: 6,
			};
			const mockCmd = getExecaMock();
			let commandStarted!: () => void;
			const commandStart = new Promise<void>((resolve) => {
				commandStarted = resolve;
			});
			const mtr = new MtrCommand((() => {
				commandStarted();
				return mockCmd;
			}) as any);
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.timedOut = true;

			timeoutError.stdout = 'x 0 33000\n'
				+ 'h 0 2606:4700:4700::1111\n'
				+ 'p 0 7990 33000\n'
				+ 'x 1 33001';

			await commandStart;
			mockCmd.reject(timeoutError);

			await runPromise;

			expect((mockedSocket.emit.lastCall.args[1] as any).result.failureSource).to.equal('internal');
		});

		it('should preserve an execa timeout if partial output parsing fails', async () => {
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const mockCmd = getExecaMock();
			const mtr = new MtrCommand((): any => mockCmd, dnsResolver('1.1.1.1'));
			const rawParseStub = sandbox.stub(MtrParser, 'rawParse').throws(new Error('Failed to parse partial output.'));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.timedOut = true;
			timeoutError.stdout = 'invalid partial output';
			mockCmd.reject(timeoutError);

			try {
				await runPromise;
			} finally {
				rawParseStub.restore();
			}

			const result = (mockedSocket.emit.lastCall.args[1] as any).result;
			expect(result.failureSource).to.equal('internal');
			expect(result.rawOutput).to.equal('invalid partial output\n\nThe measurement command timed out.');
		});

		it('should not prepend blank lines to a timeout without command output', async () => {
			const options = {
				type: 'mtr' as const,
				timeout: 5,
				target: 'jsdelivr.net',
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const mockCmd = getExecaMock();
			const mtr = new MtrCommand((): any => mockCmd, dnsResolver('1.1.1.1'));
			const runPromise = mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);
			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.stdout = '';
			timeoutError.timedOut = true;
			mockCmd.reject(timeoutError);

			await runPromise;

			expect((mockedSocket.emit.lastCall.args[1] as any).result.failureSource).to.equal('internal');
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawOutput).to.equal('The measurement command timed out.');
		});

		it('should reject private target on validation', async () => {
			try {
				await new MtrCommand((() => {
					throw new Error('should not be called');
				}) as any, dnsResolver('1.1.1.1')).run(mockedSocket as any, 'measurement', 'test', {
					type: 'mtr',
					timeout: 5,
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
