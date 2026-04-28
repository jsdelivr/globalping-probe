import { Socket } from 'socket.io-client';
import * as sinon from 'sinon';
import { expect } from 'chai';
import * as td from 'testdouble';
import { useSandboxWithFakeTimers } from '../../utils.js';
import type { StatusManager as StatusManagerType } from '../../../src/status-manager/status-manager.js';
import type { PingCommandOptions, PingOptions } from '../../../src/command/ping-command.js';

describe('StatusManager', () => {
	let StatusManager: typeof StatusManagerType;
	let initStatusManager: (socket: Socket, pingCmd: (options: PingOptions, commandOptions?: PingCommandOptions) => Promise<{ stdout: string }>) => StatusManagerType;
	let getStatusManager: () => StatusManagerType;
	let sandbox: sinon.SinonSandbox;
	let socket: sinon.SinonStubbedInstance<Socket>;
	const pingCmd = sinon.stub();
	const hasRequired = sinon.stub().resolves(true);
	const initPingTest = sinon.stub().callsFake((updateStatus: (status: 'ping-test-failed', value: boolean) => void) => ({
		start: async () => updateStatus('ping-test-failed', false),
		stop: () => {},
	}));
	const initIcmpTcpTest = sinon.stub().callsFake((updateStatus: (status: 'icmp-tcp-test-failed', value: boolean) => void) => ({
		start: async () => updateStatus('icmp-tcp-test-failed', false),
		stop: () => {},
	}));

	before(async () => {
		await td.replaceEsm('../../../src/lib/dependencies.ts', { hasRequired });
		await td.replaceEsm('../../../src/status-manager/ping-test.ts', { initPingTest });
		await td.replaceEsm('../../../src/status-manager/icmp-tcp-test.ts', { initIcmpTcpTest });
		({ StatusManager, initStatusManager, getStatusManager } = await import('../../../src/status-manager/status-manager.js'));
	});

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers({ useFakeTimers: { shouldAdvanceTime: false } });
		socket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
		hasRequired.resolves(true);
	});

	afterEach(() => {
		sandbox.restore();
		pingCmd.reset();
		hasRequired.reset();
		initPingTest.resetHistory();
		initIcmpTcpTest.resetHistory();
	});

	it('should create a manager with the `initializing` status', () => {
		const statusManager = new StatusManager(socket, pingCmd);
		expect(statusManager.getStatus()).to.equal('initializing');
		expect(socket.emit.callCount).to.equal(0);
	});

	it('should change status to `unbuffer-missing` if unbuffer is not available', async () => {
		const statusManager = new StatusManager(socket, pingCmd);
		hasRequired.resolves(false);
		await statusManager.start();
		expect(statusManager.getStatus()).to.equal('unbuffer-missing');
		expect(socket.emit.callCount).to.equal(1);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'unbuffer-missing' ]);
	});

	it('should update the status during regular checks', async () => {
		const statusManager = new StatusManager(socket, pingCmd);

		await statusManager.start();
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(2);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'initializing' ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:status:update', 'ready' ]);

		statusManager.updateStatus('ping-test-failed', true);
		expect(statusManager.getStatus()).to.equal('ping-test-failed');
		expect(socket.emit.callCount).to.equal(3);
		expect(socket.emit.args[2]).to.deep.equal([ 'probe:status:update', 'ping-test-failed' ]);

		statusManager.updateStatus('ping-test-failed', false);
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(4);
		expect(socket.emit.args[3]).to.deep.equal([ 'probe:status:update', 'ready' ]);
	});

	it('should report `icmp-tcp-test-failed` then `ready` when that flag toggles', async () => {
		const statusManager = new StatusManager(socket, pingCmd);

		await statusManager.start();
		expect(statusManager.getStatus()).to.equal('ready');

		statusManager.updateStatus('icmp-tcp-test-failed', true);
		expect(statusManager.getStatus()).to.equal('icmp-tcp-test-failed');
		expect(socket.emit.lastCall.args).to.deep.equal([ 'probe:status:update', 'icmp-tcp-test-failed' ]);

		statusManager.updateStatus('icmp-tcp-test-failed', false);
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.lastCall.args).to.deep.equal([ 'probe:status:update', 'ready' ]);
	});

	it('should stop updating the status after .stop() call', async () => {
		const statusManager = new StatusManager(socket, pingCmd);

		await statusManager.start();
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(2);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'initializing' ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:status:update', 'ready' ]);

		statusManager.stop();
		expect(statusManager.getStatus()).to.equal('sigterm');
		expect(socket.emit.callCount).to.equal(3);
		expect(socket.emit.args[2]).to.deep.equal([ 'probe:status:update', 'sigterm' ]);
	});

	it('should return the same instance for initStatusManager and getStatusManager', () => {
		const statusManager = initStatusManager(socket, pingCmd);
		const statusManager2 = getStatusManager();
		expect(statusManager).to.equal(statusManager2);
	});

	it('should use a 1 second ping interval for status checks', () => {
		new StatusManager(socket, pingCmd);

		const pingTestPingCmd = initPingTest.firstCall.args[2] as (options: PingOptions) => Promise<{ stdout: string }>;
		pingTestPingCmd({ type: 'ping', ipVersion: 4, target: 'api.globalping.io', packets: 6, protocol: 'ICMP', port: 80, inProgressUpdates: false });

		expect(pingCmd.calledOnce).to.be.true;

		expect(pingCmd.firstCall.args).to.deep.equal([
			{ type: 'ping', ipVersion: 4, target: 'api.globalping.io', packets: 6, protocol: 'ICMP', port: 80, inProgressUpdates: false },
			{ interval: 1 },
		]);
	});
});
