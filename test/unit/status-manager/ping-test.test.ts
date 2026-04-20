import { Socket } from 'socket.io-client';
import * as sinon from 'sinon';
import { expect } from 'chai';
import { getCmdMock, useSandboxWithFakeTimers } from '../../utils.js';
import { PingTest, initPingTest, getPingTest } from '../../../src/status-manager/ping-test.js';

const pingSuccess = getCmdMock('ping-success-linux');
const pingPacketLoss = getCmdMock('ping-packet-loss-linux');

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
		expect(pingCmd.args[0]).to.deep.equal([{ type: 'ping', ipVersion: 4, target: 'api.globalping.io', packets: 6, protocol: 'ICMP', port: 80, inProgressUpdates: false }]);
		expect(pingCmd.args[1]).to.deep.equal([{ type: 'ping', ipVersion: 6, target: 'api.globalping.io', packets: 6, protocol: 'ICMP', port: 80, inProgressUpdates: false }]);
		expect(pingCmd.args[2]).to.deep.equal([{ type: 'ping', ipVersion: 4, target: 'api.globalping.io', packets: 6, protocol: 'ICMP', port: 80, inProgressUpdates: false }]);
		expect(pingCmd.args[3]).to.deep.equal([{ type: 'ping', ipVersion: 6, target: 'api.globalping.io', packets: 6, protocol: 'ICMP', port: 80, inProgressUpdates: false }]);
		expect(pingCmd.args[4]).to.deep.equal([{ type: 'ping', ipVersion: 4, target: 'api.globalping.io', packets: 6, protocol: 'ICMP', port: 80, inProgressUpdates: false }]);
		expect(pingCmd.args[5]).to.deep.equal([{ type: 'ping', ipVersion: 6, target: 'api.globalping.io', packets: 6, protocol: 'ICMP', port: 80, inProgressUpdates: false }]);
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

	it('should fail if 2 of 3 ping tests reject, no ip version is supported', async () => {
		pingCmd.onCall(0).rejects({ stdout: 'host not found' });
		pingCmd.onCall(1).rejects({ stdout: 'host not found' });
		pingCmd.onCall(2).rejects({ stdout: 'host not found' });
		pingCmd.onCall(3).rejects({ stdout: 'host not found' });
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', true ]);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', false ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', false ]);
	});

	it('should pass if only 1 of 3 ping tests rejects, both ip versions are supported', async () => {
		pingCmd.onCall(0).rejects({ stdout: 'host not found' });
		pingCmd.onCall(1).rejects({ stdout: 'host not found' });
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);
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

	it('should fail if 2 of 3 ping tests resolve with packet loss', async () => {
		pingCmd.onCall(0).resolves({ stdout: pingPacketLoss });
		pingCmd.onCall(1).resolves({ stdout: pingPacketLoss });
		pingCmd.onCall(2).resolves({ stdout: pingPacketLoss });
		pingCmd.onCall(3).resolves({ stdout: pingPacketLoss });
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', true ]);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', false ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', false ]);
	});

	it('should pass if only 1 of 3 ping tests resolves with packet loss', async () => {
		pingCmd.onCall(0).resolves({ stdout: pingPacketLoss });
		pingCmd.onCall(1).resolves({ stdout: pingPacketLoss });
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);
	});

	it('should treat rejected execa error with 0% packet loss as successful (happens if command times out)', async () => {
		pingCmd.rejects({ stdout: pingSuccess, stderr: 'Command timed out', exitCode: 143 });
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);
	});

	it('should treat rejected execa error with packet loss as failed', async () => {
		pingCmd.rejects({ stdout: pingPacketLoss, stderr: 'Command timed out', exitCode: 143 });
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', true ]);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', false ]);
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

	it('should update status on interval when ping result changes', async () => {
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);

		pingCmd.rejects({ stdout: 'host not found' });
		await sandbox.clock.tickAsync(11 * 60 * 1000);

		expect(updateStatus.args[1]).to.deep.equal([ 'ping-test-failed', true ]);
		expect(socket.emit.args[2]).to.deep.equal([ 'probe:isIPv4Supported:update', false ]);
		expect(socket.emit.args[3]).to.deep.equal([ 'probe:isIPv6Supported:update', false ]);

		pingCmd.resolves({ stdout: pingSuccess });
		await sandbox.clock.tickAsync(11 * 60 * 1000);

		expect(updateStatus.args[2]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.args[4]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[5]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);
	});

	it('should update status on interval with different values for ipv4 and ipv6', async () => {
		const pingTest = new PingTest(updateStatus, socket, pingCmd);
		await pingTest.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);

		pingCmd.onCall(6).rejects({ stdout: 'host not found' });
		pingCmd.onCall(8).rejects({ stdout: 'host not found' });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(updateStatus.args[1]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.args[2]).to.deep.equal([ 'probe:isIPv4Supported:update', false ]);
		expect(socket.emit.args[3]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);

		pingCmd.onCall(13).rejects({ stdout: 'host not found' });
		pingCmd.onCall(15).rejects({ stdout: 'host not found' });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(updateStatus.args[2]).to.deep.equal([ 'ping-test-failed', false ]);
		expect(socket.emit.args[4]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[5]).to.deep.equal([ 'probe:isIPv6Supported:update', false ]);

		pingCmd.rejects({ stdout: 'host not found' });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(updateStatus.args[3]).to.deep.equal([ 'ping-test-failed', true ]);
		expect(socket.emit.args[6]).to.deep.equal([ 'probe:isIPv4Supported:update', false ]);
		expect(socket.emit.args[7]).to.deep.equal([ 'probe:isIPv6Supported:update', false ]);
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
