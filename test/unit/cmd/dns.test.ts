import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult} from '../../utils.js';
import {DnsCommand} from '../../../src/command/dns-command.js';

describe('dns command', () => {
	const sandbox = sinon.createSandbox();
	const mockSocket = sandbox.createStubInstance(Socket);

	beforeEach(() => {
		sandbox.reset();
	});

	it('should parse trace - dns-trace-success', async () => {
		const testCase = 'dns-trace-success';
		const options = {
			type: 'dns' as const,
			target: 'cdn.jsdelivr.net',
			trace: true,
			request: {},
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
			request: {
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
			request: {
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
			request: {
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
			request: {
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
