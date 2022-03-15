import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {TracerouteCommand, traceCmd} from '../../../src/command/traceroute-command.js';

describe('trace command (live)', () => {
	const sandbox = sinon.createSandbox();
	const mockSocket = sandbox.createStubInstance(Socket);

	it('should run and parse trace - google.com', async () => {
		const options = {
			target: 'google.com',
      port: 53,
      protocol: 'UDP'
		};

		const cmd = traceCmd;

		const trace = new TracerouteCommand(cmd);
		await trace.run(mockSocket as any, 'measurement', 'test', options);

		expect(mockSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
		expect(mockSocket.emit.lastCall.args[1]).to.have.property('result');
		expect(mockSocket.emit.lastCall.args[1]).to.have.nested.property('result.destination');
		expect(mockSocket.emit.lastCall.args[1]).to.have.nested.property('result.hops');
		expect(mockSocket.emit.lastCall.args[1]).to.have.nested.property('result.hops[0].host');
	}).timeout(5000);
});
