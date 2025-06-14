import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import { type ExecaError } from 'execa';
import {
	chunkOutput,
	CommandTester,
	getCmdMock,
	getCmdMockResult,
	getExecaMock,
	makeSnapshotTests,
	setupSnapshots,
	wrapIt,
} from '../../utils.js';
import {
	DnsCommand,
	argBuilder,
	type DnsOptions, dnsCmd,
} from '../../../src/command/dns-command.js';

describe('dns command', () => {
	wrapIt();
	const sandbox = sinon.createSandbox();
	const mockSocket = sandbox.createStubInstance(Socket);

	beforeEach(() => {
		sandbox.reset();
	});

	describe('argument builder', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'dns' as DnsOptions['type'],
				target: 'google.com',
				resolver: '1.1.1.1',
				protocol: 'udp',
				port: 90,
				trace: true,
				query: {
					type: 'TXT',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const args = argBuilder(options);

			expect([ args[0], args[1], args[2], args[3] ]).to.deep.equal([ '-t', 'TXT', 'google.com', '@1.1.1.1' ]);
			expect(args.join(' ')).to.include(`-t ${options.query.type}`);
			expect(args).to.include('-4');
			expect(args).to.include('+timeout=3');
			expect(args).to.include('+tries=2');
			expect(args).to.include('+nocookie');
			expect(args).to.include('+nsid');
			// Optional values:
			expect(args).to.not.include('udp'); // Udp has no flag
			expect(args).to.include('+trace');
		});

		describe('ipVersion', () => {
			it('should set -4 flag', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '1.1.1.1',
					protocol: 'udp',
					port: 90,
					trace: false,
					query: {
						type: 'TXT',
					},
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args).to.include('-4');
			});

			it('should set -6 flag', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '64:ff9b:1::1a2b:3c4d',
					protocol: 'udp',
					port: 90,
					trace: false,
					query: {
						type: 'TXT',
					},
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const args = argBuilder(options);
				expect(args).to.include('-6');
			});
		});

		describe('trace', () => {
			it('should not add the flag', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '1.1.1.1',
					protocol: 'udp',
					port: 90,
					trace: false,
					query: {
						type: 'TXT',
					},
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args).to.not.include('+trace');
			});

			it('should add the flag', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '1.1.1.1',
					protocol: 'udp',
					port: 90,
					trace: true,
					query: {
						type: 'TXT',
					},
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args).to.include('+trace');
			});
		});

		describe('port', () => {
			it('should set -p 90 flag', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '1.1.1.1',
					protocol: 'UDP',
					port: 90,
					trace: false,
					query: {
						type: 'TXT',
					},
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args.join(' ')).to.contain('-p 90');
			});
		});

		describe('type', () => {
			it('should set -t A flag before the target', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '1.1.1.1',
					protocol: 'UDP',
					port: 90,
					trace: false,
					query: {
						type: 'A',
					},
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args.join(' ')).to.contain('-t A google.com');
			});

			it('should set -x flag before the target', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: '8.8.8.8',
					resolver: '1.1.1.1',
					protocol: 'UDP',
					port: 90,
					trace: false,
					query: {
						type: 'PTR',
					},
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args.join(' ')).to.contain('-x 8.8.8.8');
			});
		});

		describe('protocol', () => {
			it('should not add the flag (UDP)', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '1.1.1.1',
					protocol: 'udp',
					port: 90,
					trace: true,
					query: {
						type: 'TXT',
					},
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				const udpFlagIndex = args.findIndex((a: string) => a.includes('udp'));
				expect(udpFlagIndex).to.equal(-1);
			});

			it('should add the flag (TCP)', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '1.1.1.1',
					protocol: 'tcp',
					port: 90,
					trace: true,
					query: {
						type: 'TXT',
					},
					inProgressUpdates: false,
					ipVersion: 4,
				};

				const args = argBuilder(options);
				expect(args).to.include('+tcp');
			});
		});
	});

	describe('command handler', () => {
		it('should parse trace - dns-trace-success', async () => {
			const testCase = 'dns-trace-success';
			const options = {
				type: 'dns' as const,
				target: 'cdn.jsdelivr.net',
				trace: true,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);
			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should parse trace with progress messages - dns-trace-success', async () => {
			const testCase = 'dns-trace-success';
			const options = {
				type: 'dns' as const,
				target: 'cdn.jsdelivr.net',
				trace: true,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks, verifyChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			verifyChunks(mockSocket);

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should parse dns - dns-success-linux', async () => {
			const testCase = 'dns-success-linux';
			const options = {
				type: 'dns' as const,
				target: 'google.com',
				trace: false,
				query: {
					type: 'TXT',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);

			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should parse dns - ipv6-resolver-dns-success', async () => {
			const testCase = 'ipv6-resolver-dns-success';
			const options = {
				type: 'dns' as const,
				target: 'google.com',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 6,
				resolver: '2606:4700:4700::1111',
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);

			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should parse dns - ipv6-ptr-dns-success', async () => {
			const testCase = 'ipv6-dns-success-ip';
			const options = {
				type: 'dns' as const,
				target: '2a00:1450:4026:802::200e',
				trace: false,
				query: {
					type: 'PTR',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 6,
				resolver: '2606:4700:4700::1111',
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);

			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should parse dns with progress messages - dns-success-linux', async () => {
			const testCase = 'dns-success-linux';
			const options = {
				type: 'dns' as const,
				target: 'google.com',
				trace: false,
				query: {
					type: 'TXT',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { lines, emitChunks, verifyChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			verifyChunks(mockSocket, lines.map(line => line.replaceAll('192.168.0.49', 'x.x.x.x')));

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should work in case of private ip - dns-resolved-private-ip-linux', async () => {
			const testCase = 'dns-resolved-private-ip-linux';
			const options = {
				type: 'dns' as const,
				target: 'gitlab.test.com',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);
			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should work in case of private ip with progress messages - dns-resolved-private-ip-linux', async () => {
			const testCase = 'dns-resolved-private-ip-linux';
			const options = {
				type: 'dns' as const,
				target: 'gitlab.test.com',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { lines, emitChunks, verifyChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			verifyChunks(mockSocket, lines.map(line => line.replaceAll('127.0.0.53', 'x.x.x.x')));

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should work in case of private ip - ipv6-dns-resolved-private-ip-linux', async () => {
			const testCase = 'ipv6-dns-resolved-private-ip-linux';
			const options = {
				type: 'dns' as const,
				target: 'gitlab.test.com',
				trace: false,
				query: {
					type: 'AAAA',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);
			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should work in case of private ip with progress messages - ipv6-dns-resolved-private-ip-linux', async () => {
			const testCase = 'ipv6-dns-resolved-private-ip-linux';
			const options = {
				type: 'dns' as const,
				target: 'gitlab.test.com',
				trace: false,
				query: {
					type: 'AAAA',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 6,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { lines, emitChunks, verifyChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			verifyChunks(mockSocket, lines.map(line => line.replaceAll('fd00::2', 'x.x.x.x')));

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should work in case of private ip with progress messages - dns-trace-resolved-private-ip-linux', async () => {
			const testCase = 'dns-trace-resolved-private-ip-linux';
			const options = {
				type: 'dns' as const,
				target: 'test.com',
				trace: true,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks, verifyChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			verifyChunks(mockSocket);

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of private ip and non-public hostname - dns-resolved-private-ip-invalid-hostname-linux', async () => {
			const testCase = 'dns-resolved-private-ip-invalid-hostname-linux';
			const options = {
				type: 'dns' as const,
				target: 'dev.home',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);
			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of private ip and non-public hostname - ipv6-dns-resolved-private-ip-invalid-hostname-linux', async () => {
			const testCase = 'ipv6-dns-resolved-private-ip-invalid-hostname-linux';
			const options = {
				type: 'dns' as const,
				target: 'dev.home',
				trace: false,
				query: {
					type: 'AAAA',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);
			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of private ip with progress messages and non-public hostname - dns-trace-resolved-private-ip-invalid-hostname-linux', async () => {
			const testCase = 'dns-trace-resolved-private-ip-invalid-hostname-linux';
			const options = {
				type: 'dns' as const,
				target: 'dev.home',
				trace: true,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			mockSocket.emit.args.forEach((call) => {
				const output = (call[1] as any).result.rawOutput;
				expect(output).to.be.a.string;
				expect(output).to.not.contain('192.168.10.10');
			});

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of private ip with progress messages and non-public hostname - ipv6-dns-trace-resolved-private-ip-invalid-hostname-linux', async () => {
			const testCase = 'ipv6-dns-trace-resolved-private-ip-invalid-hostname-linux';
			const options = {
				type: 'dns' as const,
				target: 'dev.home',
				trace: true,
				query: {
					type: 'AAAA',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 6,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			mockSocket.emit.args.forEach((call) => {
				const output = (call[1] as any).result.rawOutput;
				expect(output).to.be.a.string;
				expect(output).to.not.contain('fd00::3');
			});

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of execa error - dns-resolver-error-linux', async () => {
			const testCase = 'dns-resolver-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'google.com',
				resolver: 'sdsa',
				trace: false,
				query: {
					type: 'TXT',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);
			mockCmd.reject({ stdout: rawOutput, stderr: '' });
			await runPromise;

			expect(mockSocket.emit.calledOnce).to.be.true;
			expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should fail in case of connection refused - dns-connection-refused-error-linux', async () => {
			const testCase = 'dns-connection-refused-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'test.com',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks, verifyChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			verifyChunks(mockSocket);

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of connection refused with private ip - dns-connection-refused-private-error-linux (PRIVATE IP)', async () => {
			const testCase = 'dns-connection-refused-private-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'test.com',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);
			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of connection refused with private ip with progress messages - dns-connection-refused-private-error-linux (PRIVATE IP)', async () => {
			const testCase = 'dns-connection-refused-private-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'test.com',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 6,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { lines, emitChunks, verifyChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			verifyChunks(mockSocket, lines.map(line => line.replaceAll('192.168.0.49', 'x.x.x.x')));

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of connection refused with private ip - ipv6-dns-connection-refused-private-error-linux (PRIVATE IP)', async () => {
			const testCase = 'ipv6-dns-connection-refused-private-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'test.com',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { emitChunks } = chunkOutput(rawOutput);
			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);
			expect(mockSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of connection refused with private ip with progress messages - ipv6-dns-connection-refused-private-error-linux (PRIVATE IP)', async () => {
			const testCase = 'ipv6-dns-connection-refused-private-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'test.com',
				trace: false,
				query: {
					type: 'A',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = getExecaMock();

			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const { lines, emitChunks, verifyChunks } = chunkOutput(rawOutput);

			await emitChunks(mockCmd.stdout);

			mockCmd.resolve({ stdout: rawOutput });
			await runPromise;

			verifyChunks(mockSocket, lines.map(line => line.replaceAll('fd00::2', 'x.x.x.x')));

			expect(mockSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', expectedResult ]);
		});

		it('should fail in case of execa timeout', async () => {
			const options = {
				type: 'dns' as const,
				target: 'google.com',
				trace: false,
				query: {
					type: 'TXT',
				},
				protocol: 'UDP',
				port: 53,
				inProgressUpdates: false,
				ipVersion: 4,
			};
			const mockCmd = getExecaMock();
			const dns = new DnsCommand((): any => mockCmd);
			const runPromise = dns.run(mockSocket as any, 'measurement', 'test', options);

			const timeoutError = new Error('Timeout') as ExecaError;
			timeoutError.stderr = '';
			timeoutError.timedOut = true;
			timeoutError.stdout = '';
			mockCmd.reject(timeoutError);

			await runPromise;

			expect(mockSocket.emit.callCount).to.equal(1);

			expect(mockSocket.emit.firstCall.args).to.deep.equal([
				'probe:measurement:result',
				{
					testId: 'test',
					measurementId: 'measurement',
					result: {
						status: 'failed',
						rawOutput: '\n\nThe measurement command timed out.',
						statusCodeName: null,
						statusCode: null,
						answers: [],
						timings: { total: 0 },
						resolver: null,
					},
				},
			]);
		});
	});

	describe('snapshots', function () {
		const tester = new CommandTester<DnsOptions>(cmd => new DnsCommand(cmd), dnsCmd, mockSocket);

		before(() => {
			setupSnapshots(import.meta.url);
		});

		this.timeout(10000);

		makeSnapshotTests(tester, {
			target: 'www.jsdelivr.com',
			query: [
				{ type: 'A' },
				{ type: 'AAAA' },
				{ type: 'HTTPS' },
			],
			resolver: '8.8.8.8',
		});

		makeSnapshotTests(tester, {
			target: 'kolarik.sk',
			query: [
				{ type: 'DNSKEY' },
				{ type: 'DS' },
				{ type: 'MX' },
				{ type: 'NS' },
				{ type: 'RRSIG' },
				{ type: 'SOA' },
				{ type: 'TXT' },
			],
			resolver: '8.8.8.8',
		});

		makeSnapshotTests(tester, {
			target: 'cloudflare.com',
			query: [
				{ type: 'NSEC' },
			],
			resolver: '8.8.8.8',
		});

		makeSnapshotTests(tester, {
			target: 'cdn.jsdelivr.net',
			query: [
				{ type: 'CNAME' },
			],
			resolver: '8.8.8.8',
		});

		makeSnapshotTests(tester, {
			target: '1.1.1.1',
			query: [
				{ type: 'PTR' },
			],
			resolver: '8.8.8.8',
		});

		makeSnapshotTests(tester, {
			target: 'www.jsdelivr.com',
			query: [{ type: 'ANY' }],
			resolver: [ '1.1.1.1', '8.8.8.8', 'a.root-servers.net' ],
		});

		makeSnapshotTests(tester, {
			target: '.',
			query: [{ type: 'ANY' }],
			resolver: '8.8.8.8',
		});

		makeSnapshotTests(tester, {
			target: 'com',
			query: [{ type: 'ANY' }],
			resolver: '8.8.8.8',
		});

		makeSnapshotTests(tester, {
			target: '_dns.resolver.arpa',
			query: [{ type: 'SVCB' }],
			resolver: '8.8.8.8',
		});
	});
});
