import { Socket } from 'socket.io-client';
import * as sinon from 'sinon';
import { expect } from 'chai';
import { getCmdMock, useSandboxWithFakeTimers } from '../../utils.js';
import { PingTest, initPingTest, getPingTest } from '../../../src/status-manager/ping-test.js';

const pingSuccess = getCmdMock('ping-success-linux');

describe('PingTest', () => {
	let sandbox: sinon.SinonSandbox;
	let socket: sinon.SinonStubbedInstance<Socket>;
	let updateStatus: sinon.SinonStub;
	let pingCmd: sinon.SinonStub;

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers();
		socket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
		updateStatus = sandbox.stub();
		pingCmd = sandbox.stub();
		pingCmd.resolves({ stdout: pingSuccess });
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('should mark ping test as passed and emit IPv4/IPv6 support', async () => {
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.callCount).to.equal(2);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);
	});

	it('should mark ping test as failed when both ip families fail', async () => {
		pingCmd.rejects({ stdout: 'host not found' });
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', true ]);
		expect(socket.emit.callCount).to.equal(2);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', false ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', false ]);
	});

	it('should pass when at least one ip family passes', async () => {
		pingCmd.callsFake(async ({ ipVersion }: { ipVersion: number }) => {
			if (ipVersion === 6) {
				throw new Error('host not found');
			}

			return { stdout: pingSuccess };
		});

		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.callCount).to.equal(2);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', false ]);
	});

	it('should run tests again on interval', async () => {
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();
		await sandbox.clock.tickAsync(11 * 60 * 1000);

		expect(pingCmd.callCount).to.equal(12);
		expect(updateStatus.callCount).to.equal(2);
		expect(socket.emit.callCount).to.equal(4);
	});

	it('should stop interval checks after stop call', async () => {
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();
		pingTest.stop();
		await sandbox.clock.tickAsync(11 * 60 * 1000);

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.callCount).to.equal(1);
		expect(socket.emit.callCount).to.equal(2);
	});

	it('should return same instance for initPingTest and getPingTest', () => {
		const pingTest = initPingTest(updateStatus, socket, pingCmd);
		const pingTest2 = getPingTest();

		expect(pingTest).to.equal(pingTest2);
	});
});
