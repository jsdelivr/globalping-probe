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

	it('should parse trace - dns-success-linux', async () => {
		const testCase = 'dns-success-linux';
		const options = {
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

	it('should return ExecaError - dns-success-linux', async () => {
		const testCase = 'dns-resolver-error-linux';
		const options = {
			target: 'google.com',
			query: {
				type: 'TXT',
				resolver: 'sdsa',
			},
		};

		const rawOutput = getCmdMock(testCase);
		const expectedResult = getCmdMockResult(testCase);

		// eslint-disable-next-line prefer-promise-reject-errors
		const mockCmd = Promise.reject({stderr: rawOutput});

		const dns = new DnsCommand((): any => mockCmd);
		await dns.run(mockSocket as any, 'measurement', 'test', options);

		expect(mockSocket.emit.calledOnce).to.be.true;
		expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
		expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
	});
});
