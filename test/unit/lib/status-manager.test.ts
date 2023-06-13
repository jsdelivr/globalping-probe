import { Socket } from 'socket.io-client';
import * as sinon from 'sinon';
import { expect } from 'chai';
import * as td from 'testdouble';
import type { ExecaChildProcess } from 'execa';
import { getCmdMock } from '../../utils.js';
import type { StatusManager } from '../../../src/lib/status-manager.js';
import type { PingOptions } from '../../../src/command/ping-command.js';

const pingSuccess = getCmdMock('ping-success-linux');
const pingPacketLoss = getCmdMock('ping-packet-loss-linux');

describe('StatusManager', () => {
	let initStatusManager: (socket: Socket, pingCmd: (options: PingOptions) => ExecaChildProcess) => StatusManager;
	let getStatusManager: () => StatusManager;
	let sandbox: sinon.SinonSandbox;
	let socket: sinon.SinonStubbedInstance<Socket>;
	const pingCmd = sinon.stub().resolves({ stdout: pingSuccess });
	const hasRequired = sinon.stub().resolves(true);

	before(async () => {
		await td.replaceEsm('../../../src/lib/dependencies.ts', { hasRequired });
		({ initStatusManager, getStatusManager } = await import('../../../src/lib/status-manager.js'));
	});

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true });
		socket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
		pingCmd.resolves({ stdout: pingSuccess });
		hasRequired.resolves(true);
	});

	afterEach(() => {
		sandbox.restore();
		pingCmd.reset();
		hasRequired.reset();
	});

	it('should create a manager with the `initializing` status', () => {
		const statusManager = initStatusManager(socket, pingCmd);
		expect(statusManager.getStatus()).to.equal('initializing');
		expect(socket.emit.callCount).to.equal(0);
	});

	it('should change status to `unbuffer-missing` if unbuffer is not available', async () => {
		const statusManager = initStatusManager(socket, pingCmd);
		hasRequired.resolves(false);
		await statusManager.start();
		expect(statusManager.getStatus()).to.equal('unbuffer-missing');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'unbuffer-missing' ]);
	});

	it('should change status to `ping-test-failed` if unbuffer is available but ping test failed', async () => {
		const statusManager = initStatusManager(socket, pingCmd);
		pingCmd.rejects({ stdout: 'host not found' });
		await statusManager.start();
		expect(pingCmd.callCount).to.equal(3);
		expect(pingCmd.args[0]).to.deep.equal([{ type: 'ping', target: 'ns1.registry.in', packets: 6, inProgressUpdates: false }]);
		expect(pingCmd.args[1]).to.deep.equal([{ type: 'ping', target: 'k.root-servers.net', packets: 6, inProgressUpdates: false }]);
		expect(pingCmd.args[2]).to.deep.equal([{ type: 'ping', target: 'ns1.dns.nl', packets: 6, inProgressUpdates: false }]);
		expect(statusManager.getStatus()).to.equal('ping-test-failed');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ping-test-failed' ]);
	});

	it('should change status to `ping-test-failed` if 2 of 3 ping tests rejects', async () => {
		const statusManager = initStatusManager(socket, pingCmd);
		pingCmd.onFirstCall().rejects({ stdout: 'host not found' });
		pingCmd.onSecondCall().rejects({ stdout: 'host not found' });
		await statusManager.start();
		expect(pingCmd.callCount).to.equal(3);
		expect(statusManager.getStatus()).to.equal('ping-test-failed');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ping-test-failed' ]);
	});

	it('should change status to `ping-test-failed` if 1 of 3 ping tests rejects', async () => {
		const statusManager = initStatusManager(socket, pingCmd);
		pingCmd.onFirstCall().rejects({ stdout: 'host not found' });
		await statusManager.start();
		expect(pingCmd.callCount).to.equal(3);
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ready' ]);
	});

	it('should change status to `ping-test-failed` if 2 of 3 ping tests resolves with packet loss', async () => {
		const statusManager = initStatusManager(socket, pingCmd);
		pingCmd.onFirstCall().resolves({ stdout: pingPacketLoss });
		pingCmd.onSecondCall().resolves({ stdout: pingPacketLoss });
		await statusManager.start();
		expect(pingCmd.callCount).to.equal(3);
		expect(statusManager.getStatus()).to.equal('ping-test-failed');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ping-test-failed' ]);
	});

	it('should change status to `ping-test-failed` if 1 of 3 ping tests resolves with packet loss', async () => {
		const statusManager = initStatusManager(socket, pingCmd);
		pingCmd.onFirstCall().resolves({ stdout: pingPacketLoss });
		await statusManager.start();
		expect(pingCmd.callCount).to.equal(3);
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ready' ]);
	});

	it('should change status to `ready` if 3 of 3 ping tests resolves', async () => {
		const statusManager = initStatusManager(socket, pingCmd);
		await statusManager.start();
		expect(pingCmd.callCount).to.equal(3);
		expect(pingCmd.args[0]).to.deep.equal([{ type: 'ping', target: 'ns1.registry.in', packets: 6, inProgressUpdates: false }]);
		expect(pingCmd.args[1]).to.deep.equal([{ type: 'ping', target: 'k.root-servers.net', packets: 6, inProgressUpdates: false }]);
		expect(pingCmd.args[2]).to.deep.equal([{ type: 'ping', target: 'ns1.dns.nl', packets: 6, inProgressUpdates: false }]);
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ready' ]);
	});

	it('should run check in a fixed intervals and do emit with a status every time', async () => {
		const statusManager = initStatusManager(socket, pingCmd);
		expect(pingCmd.callCount).to.equal(0);
		await statusManager.start();
		expect(pingCmd.callCount).to.equal(3);
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ready' ]);
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(pingCmd.callCount).to.equal(6);
		expect(socket.emit.callCount).to.equal(2);
	});

	it('should update the status during regular checks', async () => {
		const statusManager = initStatusManager(socket, pingCmd);

		await statusManager.start();
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ready' ]);

		pingCmd.rejects({ stdout: 'host not found' });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(statusManager.getStatus()).to.equal('ping-test-failed');
		expect(socket.emit.callCount).to.equal(2);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:status:update', 'ping-test-failed' ]);

		pingCmd.resolves({ stdout: pingSuccess });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(3);
		expect(socket.emit.args[2]).to.deep.equal([ 'probe:status:update', 'ready' ]);
	});

	it('should stop updating the status during regular checks after .stop() call', async () => {
		const statusManager = initStatusManager(socket, pingCmd);

		await statusManager.start();
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ready' ]);

		statusManager.stop('sigterm');
		expect(socket.emit.callCount).to.equal(2);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:status:update', 'sigterm' ]);

		pingCmd.rejects({ stdout: 'host not found' });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(statusManager.getStatus()).to.equal('sigterm');
		expect(socket.emit.callCount).to.equal(2);

		pingCmd.resolves({ stdout: pingSuccess });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(statusManager.getStatus()).to.equal('sigterm');
		expect(socket.emit.callCount).to.equal(2);
	});

	it('should return the same instance for initStatusManager and getStatusManager', () => {
		const statusManager = initStatusManager(socket, pingCmd);
		const statusManager2 = getStatusManager();
		expect(statusManager).to.equal(statusManager2);
	});
});
