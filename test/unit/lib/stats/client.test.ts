import * as sinon from 'sinon';
import {Socket} from 'socket.io-client';
import {expect} from 'chai';
import {run} from '../../../../src/lib/stats/client.js';

describe('stats client', () => {
	let sandbox: sinon.SinonSandbox;
	let mockSocket: sinon.SinonStubbedInstance<Socket>;

	beforeEach(() => {
		sandbox = sinon.createSandbox({useFakeTimers: true});
		mockSocket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('should regularly emit stats event', async () => {
		const worker = {jobs: new Map()};

		run(mockSocket, worker);

		expect(mockSocket.emit.notCalled).to.be.true;
		await sandbox.clock.tickAsync(15 * 1000);
		expect(mockSocket.emit.calledOnce).to.be.true;
		expect(mockSocket.emit.firstCall.args[0]).to.equal('probe:stats:report');
	});
});
