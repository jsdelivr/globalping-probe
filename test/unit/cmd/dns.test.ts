import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult} from '../../utils.js';
import {DnsCommand} from '../../../src/command/dns-command.js';

describe.only('dns command', () => {
	const sandbox = sinon.createSandbox();
	const mockSocket = sandbox.createStubInstance(Socket);

	beforeEach(() => {
		sandbox.reset();
	});

	describe('mock', () => {
		const testCases = ['dns-success-linux'];

		for (const testCase of testCases) {
			it(`should parse trace - ${testCase}`, async () => {
				const options = {
					target: 'google.com',
					query: {
						type: 'TXT',
					},
				};

				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockCmd = Promise.resolve({stdout: rawOutput});

				const ping = new DnsCommand((): any => mockCmd);
				await ping.run(mockSocket as any, 'measurement', 'test', options);

				expect(mockSocket.emit.calledOnce).to.be.true;
				expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
				expect(mockSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
			});
		}
	});
});
