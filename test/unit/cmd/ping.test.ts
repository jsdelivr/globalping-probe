import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult} from '../../utils.js';
import {PingCommand} from '../../../src/command/ping-command.js';

describe('ping command executor', () => {
	const sandbox = sinon.createSandbox();
	const mockedSocket = sandbox.createStubInstance(Socket);

	const testCases = ['ping-success-linux', 'ping-timeout-linux', 'ping-success-mac', 'ping-timeout-mac', 'ping-private-ip-linux'];

	beforeEach(() => {
		sandbox.reset();
	});

	for (const testCase of testCases) {
		it(`should run and parse ping - ${testCase}`, async () => {
			const rawOutput = getCmdMock(testCase);
			const expectedResult = getCmdMockResult(testCase);

			const mockedCmd = Promise.resolve({stdout: rawOutput});

			const ping = new PingCommand((): any => mockedCmd);
			await ping.run(mockedSocket as any, 'measurement', 'test', {target: 'google.com'});

			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});
	}
});
