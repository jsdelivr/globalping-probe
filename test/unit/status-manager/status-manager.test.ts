import { Socket } from 'socket.io-client';
import * as sinon from 'sinon';
import { expect } from 'chai';
import * as td from 'testdouble';
import type { ExecaChildProcess } from 'execa';
import { getCmdMock, useSandboxWithFakeTimers } from '../../utils.js';
import type { StatusManager as StatusManagerType } from '../../../src/status-manager/status-manager.js';
import type { PingOptions } from '../../../src/command/ping-command.js';

const pingSuccess = getCmdMock('ping-success-linux');

describe('StatusManager', () => {
	let StatusManager: typeof StatusManagerType;
	let initStatusManager: (socket: Socket, pingCmd: (options: PingOptions) => ExecaChildProcess) => StatusManagerType;
	let getStatusManager: () => StatusManagerType;
	let sandbox: sinon.SinonSandbox;
	let socket: sinon.SinonStubbedInstance<Socket>;
	const pingCmd = sinon.stub().resolves({ stdout: pingSuccess });
	const hasRequired = sinon.stub().resolves(true);

	before(async () => {
		await td.replaceEsm('../../../src/lib/dependencies.ts', { hasRequired });
		({ StatusManager, initStatusManager, getStatusManager } = await import('../../../src/status-manager/status-manager.js'));
	});

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers({ useFakeTimers: { shouldAdvanceTime: false } });
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
		expect(socket.emit.callCount).to.equal(3);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ready' ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[2]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);

		pingCmd.rejects({ stdout: 'host not found' });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(statusManager.getStatus()).to.equal('ping-test-failed');
		expect(socket.emit.callCount).to.equal(6);
		expect(socket.emit.args[3]).to.deep.equal([ 'probe:status:update', 'ping-test-failed' ]);
		expect(socket.emit.args[4]).to.deep.equal([ 'probe:isIPv4Supported:update', false ]);
		expect(socket.emit.args[5]).to.deep.equal([ 'probe:isIPv6Supported:update', false ]);

		pingCmd.resolves({ stdout: pingSuccess });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(9);
		expect(socket.emit.args[6]).to.deep.equal([ 'probe:status:update', 'ready' ]);
		expect(socket.emit.args[7]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[8]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);
	});

	it('should stop updating the status during regular checks after .stop() call', async () => {
		const statusManager = new StatusManager(socket, pingCmd);

		await statusManager.start();
		expect(statusManager.getStatus()).to.equal('ready');
		expect(socket.emit.callCount).to.equal(3);
		expect(socket.emit.args[0]).to.deep.equal([ 'probe:status:update', 'ready' ]);
		expect(socket.emit.args[1]).to.deep.equal([ 'probe:isIPv4Supported:update', true ]);
		expect(socket.emit.args[2]).to.deep.equal([ 'probe:isIPv6Supported:update', true ]);

		statusManager.stop();
		expect(socket.emit.callCount).to.equal(4);
		expect(socket.emit.args[3]).to.deep.equal([ 'probe:status:update', 'sigterm' ]);

		pingCmd.rejects({ stdout: 'host not found' });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(statusManager.getStatus()).to.equal('sigterm');
		expect(socket.emit.callCount).to.equal(4);

		pingCmd.resolves({ stdout: pingSuccess });
		await sandbox.clock.tickAsync(11 * 60 * 1000);
		expect(statusManager.getStatus()).to.equal('sigterm');
		expect(socket.emit.callCount).to.equal(4);
	});

	it('should return the same instance for initStatusManager and getStatusManager', () => {
		const statusManager = initStatusManager(socket, pingCmd);
		const statusManager2 = getStatusManager();
		expect(statusManager).to.equal(statusManager2);
	});
});
