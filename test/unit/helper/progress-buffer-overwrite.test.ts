import { Socket } from 'socket.io-client';
import * as sinon from 'sinon';
import { expect } from 'chai';
import { ProgressBufferOverwrite } from '../../../src/helper/progress-buffer-overwrite.js';

describe('progress buffer overwrite', () => {
	let sandbox: sinon.SinonSandbox;
	let mockedSocket: sinon.SinonStubbedInstance<Socket>;

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true });
		mockedSocket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('should send first message immideately', () => {
		const progressBuffer = new ProgressBufferOverwrite(mockedSocket, 'test-id', 'measurement-id');

		progressBuffer.pushProgress({ rawOutput: 'a' });
		progressBuffer.pushProgress({ rawOutput: 'b' });
		progressBuffer.pushProgress({ rawOutput: 'c' });

		expect(mockedSocket.emit.calledOnce).to.be.true;
		expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:progress');

		expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal({
			measurementId: 'measurement-id',
			result: {
				rawOutput: 'a',
			},
			overwrite: true,
			testId: 'test-id',
		});
	});

	it('should overwrite all messages after the first and send the last one in fixed time intervals', () => {
		const progressBuffer = new ProgressBufferOverwrite(mockedSocket, 'test-id', 'measurement-id');

		progressBuffer.pushProgress({ rawOutput: 'a' });
		progressBuffer.pushProgress({ rawOutput: 'b' });
		progressBuffer.pushProgress({ rawOutput: 'c' });
		sandbox.clock.tick(700);
		progressBuffer.pushProgress({ rawOutput: 'd' });
		progressBuffer.pushProgress({ rawOutput: 'e' });
		sandbox.clock.tick(700);

		expect(mockedSocket.emit.callCount).to.equal(3);
		expect(mockedSocket.emit.secondCall.args[0]).to.equal('probe:measurement:progress');

		expect(mockedSocket.emit.secondCall.args[1]).to.deep.equal({
			measurementId: 'measurement-id',
			result: {
				rawOutput: 'c',
			},
			overwrite: true,
			testId: 'test-id',
		});

		expect(mockedSocket.emit.thirdCall.args[0]).to.equal('probe:measurement:progress');

		expect(mockedSocket.emit.thirdCall.args[1]).to.deep.equal({
			measurementId: 'measurement-id',
			result: {
				rawOutput: 'e',
			},
			overwrite: true,
			testId: 'test-id',
		});
	});

	it('should ignore pending messages and only send result if pushResult was called', () => {
		const progressBuffer = new ProgressBufferOverwrite(mockedSocket, 'test-id', 'measurement-id');

		progressBuffer.pushProgress({ rawOutput: 'a' });
		progressBuffer.pushProgress({ rawOutput: 'b' });
		progressBuffer.pushProgress({ rawOutput: 'c' });
		progressBuffer.pushResult({ status: 'finished', resolvedAddress: null, resolvedHostname: null, rawOutput: 'abc', hops: [] });
		sandbox.clock.tick(700);

		expect(mockedSocket.emit.callCount).to.equal(2);
		expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:progress');

		expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal({
			measurementId: 'measurement-id',
			result: {
				rawOutput: 'a',
			},
			overwrite: true,
			testId: 'test-id',
		});

		expect(mockedSocket.emit.secondCall.args[0]).to.equal('probe:measurement:result');

		expect(mockedSocket.emit.secondCall.args[1]).to.deep.equal({
			measurementId: 'measurement-id',
			result: {
				status: 'finished',
				resolvedAddress: null,
				resolvedHostname: null,
				rawOutput: 'abc',
				hops: [],
			},
			testId: 'test-id',
		});
	});
});
