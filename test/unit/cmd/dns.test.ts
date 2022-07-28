import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult} from '../../utils.js';
import {
	DnsCommand,
	argBuilder,
} from '../../../src/command/dns-command.js';

import type {DnsOptions} from '../../../src/command/dns-command.js';

describe('dns command', () => {
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
			};

			const args = argBuilder(options);

			expect(args[0]).to.equal(options.target);
			expect(args.join(' ')).to.include(`-t ${options.query.type}`);
			expect(args).to.include('-4');
			expect(args).to.include('+timeout=3');
			expect(args).to.include('+tries=2');
			expect(args).to.include('+nocookie');
			// Optional values
			expect(args[1]).to.equal(`@${options.resolver}`);
			// Udp has no flag
			expect(args).to.not.include('udp');
			expect(args).to.include('+trace');
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
					port: 90,
					query: {
						type: 'TXT',
					},
				};

				const args = argBuilder(options);
				expect(args.join(' ')).to.contain('-p 90');
			});
		});

		describe('type', () => {
			it('should set -t A flag', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: 'google.com',
					resolver: '1.1.1.1',
					port: 90,
					query: {
						type: 'A',
					},
				};

				const args = argBuilder(options);
				expect(args.join(' ')).to.contain('-t A');
			});

			it('should set -x PTR flag', () => {
				const options = {
					type: 'dns' as DnsOptions['type'],
					target: '8.8.8.8',
					resolver: '1.1.1.1',
					port: 90,
					query: {
						type: 'PTR',
					},
				};

				const args = argBuilder(options);
				expect(args.join(' ')).to.contain('-x');
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
				query: {},
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = Promise.resolve({stdout: rawOutput});

			const dns = new DnsCommand((): any => mockCmd);
			await dns.run(mockSocket as any, 'measurement', 'test', options);

			expect(mockSocket.emit.calledOnce).to.be.true;
			expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should parse dns - dns-success-linux', async () => {
			const testCase = 'dns-success-linux';
			const options = {
				type: 'dns' as const,
				target: 'google.com',
				query: {
					type: 'TXT',
				},
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = Promise.resolve({stdout: rawOutput});

			const dns = new DnsCommand((): any => mockCmd);
			await dns.run(mockSocket as any, 'measurement', 'test', options);

			expect(mockSocket.emit.calledOnce).to.be.true;
			expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should return ExecaError - dns-resolver-error-linux', async () => {
			const testCase = 'dns-resolver-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'google.com',
				resolver: 'sdsa',
				query: {
					type: 'TXT',
				},
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			// eslint-disable-next-line prefer-promise-reject-errors
			const mockCmd = Promise.reject({stdout: rawOutput, stderr: ''});

			const dns = new DnsCommand((): any => mockCmd);
			await dns.run(mockSocket as any, 'measurement', 'test', options);

			expect(mockSocket.emit.calledOnce).to.be.true;
			expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should return private IP error - dns-resolved-private-ip-error-linux', async () => {
			const testCase = 'dns-resolved-private-ip-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'gitlab.test.com',
				query: {
					type: 'A',
				},
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = Promise.resolve({stdout: rawOutput});

			const dns = new DnsCommand((): any => mockCmd);
			await dns.run(mockSocket as any, 'measurement', 'test', options);

			expect(mockSocket.emit.calledOnce).to.be.true;
			expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should return private IP error - dns-trace-resolved-private-ip-error-linux', async () => {
			const testCase = 'dns-trace-resolved-private-ip-error-linux';
			const options = {
				type: 'dns' as const,
				target: 'test.com',
				trace: true,
				query: {
					type: 'A',
				},
			};

			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockCmd = Promise.resolve({stdout: rawOutput});

			const dns = new DnsCommand((): any => mockCmd);
			await dns.run(mockSocket as any, 'measurement', 'test', options);

			expect(mockSocket.emit.calledOnce).to.be.true;
			expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});
	});

	it('should return connection refused error - dns-connection-refused-error-linux', async () => {
		const testCase = 'dns-connection-refused-error-linux';
		const options = {
			type: 'dns' as const,
			target: 'test.com',
			query: {
				type: 'A',
			},
		};

		const rawOutput = getCmdMock(testCase);
		const expectedResult = getCmdMockResult(testCase);

		const mockCmd = Promise.resolve({stdout: rawOutput});

		const dns = new DnsCommand((): any => mockCmd);
		await dns.run(mockSocket as any, 'measurement', 'test', options);

		expect(mockSocket.emit.calledOnce).to.be.true;
		expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
		expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
	});

	it('should return connection refused error - dns-connection-refused-private-error-linux (PRIVATE IP)', async () => {
		const testCase = 'dns-connection-refused-private-error-linux';
		const options = {
			type: 'dns' as const,
			target: 'test.com',
			query: {
				type: 'A',
			},
		};

		const rawOutput = getCmdMock(testCase);
		const expectedResult = getCmdMockResult(testCase);

		const mockCmd = Promise.resolve({stdout: rawOutput});

		const dns = new DnsCommand((): any => mockCmd);
		await dns.run(mockSocket as any, 'measurement', 'test', options);

		expect(mockSocket.emit.calledOnce).to.be.true;
		expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
		expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
	});
});
