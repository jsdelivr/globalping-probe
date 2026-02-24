import config from 'config';
import process from 'node:process';
import { expect } from 'chai';
import * as td from 'testdouble';
import * as sinon from 'sinon';
import { getCmdMock, MockSocket, useSandboxWithFakeTimers } from '../utils.js';
import { StatusManager } from '../../src/lib/status-manager.js';

const pingStdout = getCmdMock('ping-success-linux');
const fakeLocation = {
	continent: 'EU',
	region: 'Western Europe',
	country: 'BE',
	city: 'Brussels',
	asn: 396_982,
	latitude: 50.8505,
	longitude: 4.3488,
	state: null,
};

describe('index module', () => {
	let sandbox: sinon.SinonSandbox;
	const execaStub = sinon.stub();
	const runIcmpStub = sinon.stub();
	const PingCommandStub = sinon.stub().returns({
		run (...args: unknown[]) { return this.runIcmp(pingCmdStub, ...args); },
		runIcmp: runIcmpStub,
	});
	const pingCmdStub = sinon.stub().returns({ stdout: pingStdout });
	const statusManagerStub = sinon.createStubInstance(StatusManager);
	statusManagerStub.getStatus.returns('ready');
	const initStatusManagerStub = sinon.stub().returns(statusManagerStub);
	const getStatusManagerStub = sinon.stub().returns(statusManagerStub);

	const mockSocket = new MockSocket();
	const handlers = {
		'probe:status:update': sinon.stub(),
		'probe:dns:update': sinon.stub(),
		'probe:measurement:request': sinon.stub(),
		'probe:measurement:ack': sinon.stub(),
		'connect_error': sinon.stub(),
	};
	const connectStub = sinon.stub();
	const disconnectStub = sinon.stub();

	for (const [ event, handler ] of Object.entries(handlers)) {
		mockSocket.on(event, handler);
	}

	mockSocket.connect = connectStub;
	mockSocket.disconnect = disconnectStub;
	const ioStub = sinon.stub().returns(mockSocket);

	before(async () => {
		await td.replaceEsm('execa', { execa: execaStub });
		await td.replaceEsm('socket.io-client', { io: ioStub });
		await td.replaceEsm('../../src/command/ping-command.ts', { PingCommand: PingCommandStub, pingCmd: pingCmdStub });
		await td.replaceEsm('../../src/lib/status-manager.ts', { initStatusManager: initStatusManagerStub, getStatusManager: getStatusManagerStub });
		process.env['GP_HOST_HW'] = 'true';
		process.env['GP_HOST_DEVICE'] = 'v1';
	});

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers();
	});

	afterEach(() => {
		execaStub.reset();
		runIcmpStub.reset();

		for (const stub of Object.values(handlers)) {
			stub.reset();
		}

		statusManagerStub.updateStatus.reset();
		statusManagerStub.stop.reset();
		statusManagerStub.sendStatus.reset();
		statusManagerStub.getStatus.reset();
		statusManagerStub.getStatus.returns('ready');

		connectStub.reset();
		disconnectStub.reset();
		sandbox.restore();
	});

	after(() => {
		td.reset();
		process.removeAllListeners('SIGTERM');
	});

	it('should load unbuffer and ignore measurement requests until get location data', async () => {
		statusManagerStub.getStatus.returns('initializing');
		await import('../../src/probe.js');
		mockSocket.emit('connect');
		await sandbox.clock.nextAsync();

		mockSocket.emit('probe:measurement:request', { id: '123', measurement: { type: 'ping' } });

		expect((execaStub.firstCall.args[0] as string).endsWith('/src/sh/unbuffer.sh')).to.be.true;
		expect(initStatusManagerStub.callCount).to.equal(1);
		expect(handlers['probe:measurement:ack'].notCalled).to.be.true;
		expect(runIcmpStub.notCalled).to.be.true;
	});

	it('should initialize and connect to the API server', async () => {
		await import('../../src/probe.js');
		mockSocket.emit('connect');
		mockSocket.emit('api:connect:location', fakeLocation);

		await sandbox.clock.nextAsync();

		expect(ioStub.calledOnce).to.be.true;
		expect(ioStub.firstCall.args[0]).to.equal(`${config.get('api.host')}/probes`);

		expect(ioStub.firstCall.args[1]).to.deep.include({
			transports: [ 'websocket' ],
			reconnectionDelay: 4000,
			reconnectionDelayMax: 8000,
			randomizationFactor: 0.5,
		});

		expect(ioStub.firstCall.args[1].query.version).to.match(/^\d+.\d+.\d+$/);
		expect(ioStub.firstCall.args[1].query.nodeVersion).to.match(/^v\d+.\d+.\d+$/);
		expect(ioStub.firstCall.args[1].query.isHardware).to.deep.equal('true');
		expect(ioStub.firstCall.args[1].query.hardwareDevice).to.deep.equal('v1');

		expect(statusManagerStub.sendStatus.callCount).to.equal(1);
		expect(initStatusManagerStub.callCount).to.equal(1);
		expect(initStatusManagerStub.firstCall.args).to.deep.equal([ mockSocket, pingCmdStub ]);
		expect(handlers['probe:dns:update'].calledOnce).to.be.true;
	});

	it('should disconnect on "connect_error"', async () => {
		const exitStub = sandbox.stub(process, 'exit');

		await import('../../src/probe.js');
		mockSocket.emit('connect_error', new Error());
		mockSocket.emit('connect_error', { message: 'failed to collect probe metadata' });
		mockSocket.emit('connect_error', { message: 'vpn detected' });

		expect(disconnectStub.callCount).to.equal(3);
		expect(exitStub.notCalled).to.be.true;
	});

	it('should exit on "connect_error" for invalid probe version', async () => {
		const exitStub = sandbox.stub(process, 'exit');

		await import('../../src/probe.js');
		mockSocket.emit('connect_error', { message: 'invalid probe version' });

		expect(exitStub.calledOnce).to.be.true;
	});

	it('should start measurement request', async () => {
		await import('../../src/probe.js');
		mockSocket.emit('connect');
		mockSocket.emit('api:connect:location', fakeLocation);
		await sandbox.clock.nextAsync();

		mockSocket.emit('probe:measurement:request', { measurementId: 'measurementid', testId: 'testid', measurement: { type: 'ping' } });

		expect(PingCommandStub.calledOnce).to.be.true;
		expect(handlers['probe:measurement:ack'].calledOnce).to.be.true;
		expect(runIcmpStub.calledOnce).to.be.true;
		expect(runIcmpStub.firstCall.args[0]).to.equal(pingCmdStub);
		expect(runIcmpStub.firstCall.args[1]).to.equal(mockSocket);
		expect(runIcmpStub.firstCall.args[2]).to.equal('measurementid');
		expect(runIcmpStub.firstCall.args[3]).to.equal('testid');
		expect(runIcmpStub.firstCall.args[4]).to.deep.equal({ type: 'ping' });
	});

	it('should return error message in case of error', async () => {
		await import('../../src/probe.js');
		mockSocket.emit('connect');
		mockSocket.emit('api:connect:location', fakeLocation);
		await sandbox.clock.nextAsync();
		runIcmpStub.rejects(new Error('Some error message'));

		mockSocket.emit('probe:measurement:request', { measurementId: 'measurementid', testId: 'testid', measurement: { type: 'ping' } });
		const emitSpy = sinon.spy(mockSocket, 'emit');
		await sandbox.clock.nextAsync();

		expect(emitSpy.callCount).to.equal(1);

		expect(emitSpy.getCall(0).args).to.deep.equal([
			'probe:measurement:result',
			{
				testId: 'testid',
				measurementId: 'measurementid',
				result: { status: 'failed', rawOutput: 'Some error message' },
			},
		]);
	});

	it('should reconnect on "disconnect" event from API', async () => {
		await import('../../src/probe.js');

		mockSocket.emit('disconnect');
		expect(connectStub.notCalled).to.be.true;
		mockSocket.emit('disconnect', 'io server disconnect');
		sandbox.clock.tick(2000 + 50);
		expect(connectStub.calledOnce).to.be.true;
	});

	it('should reconnect after 1 hour delay on "probe" type errors', async () => {
		await import('../../src/probe.js');

		mockSocket.emit('connect_error', new Error('ip limit'));
		mockSocket.emit('connect_error', new Error('vpn detected'));
		mockSocket.emit('connect_error', new Error('unresolvable geoip'));

		sandbox.clock.tick(60 * 1000 + 50);
		expect(connectStub.callCount).to.equal(0);
		sandbox.clock.tick(60 * 60 * 1000 + 50);
		expect(connectStub.callCount).to.equal(3);
	});

	it('should reconnect after 1 minute delay on "api" type errors', async () => {
		await import('../../src/probe.js');

		mockSocket.emit('connect_error', new Error('failed to collect probe metadata'));

		sandbox.clock.tick(1000 + 50);
		expect(connectStub.callCount).to.equal(0);
		sandbox.clock.tick(60 * 1000 + 50);
		expect(connectStub.callCount).to.equal(1);
	});

	it('should reconnect after 2 seconds delay on "connect_error" with other messages', async () => {
		await import('../../src/probe.js');

		mockSocket.emit('connect_error', new Error('some message'));

		expect(connectStub.callCount).to.equal(0);
		sandbox.clock.tick(2000 + 50);
		expect(connectStub.callCount).to.equal(1);
	});

	it('should exit on SIGTERM if there are no active measurements', async () => {
		const exitStub = sandbox.stub(process, 'exit');
		await import('../../src/probe.js');

		process.once('SIGTERM', () => {
			sandbox.clock.tick(150);
			expect(statusManagerStub.stop.callCount).to.equal(1);
			expect(statusManagerStub.stop.args[0]).to.deep.equal([ 'sigterm' ]);
			expect(exitStub.calledOnce).to.be.true;
		});

		process.emit('SIGTERM');
	});

	it('should exit on SIGTERM if there are active measurements', async () => {
		const exitStub = sandbox.stub(process, 'exit');
		await import('../../src/probe.js');
		mockSocket.emit('connect');
		mockSocket.emit('probe:measurement:request', { id: '123', measurement: { type: 'ping' } });

		process.once('SIGTERM', () => {
			sandbox.clock.tick(60_500);
			expect(statusManagerStub.stop.callCount).to.equal(1);
			expect(statusManagerStub.stop.args[0]).to.deep.equal([ 'sigterm' ]);
			expect(exitStub.calledOnce).to.be.true;
		});

		process.emit('SIGTERM');
	});

	it('should exit on "probe:sigkill" event', async () => {
		const exitStub = sandbox.stub(process, 'exit');

		await import('../../src/probe.js');
		mockSocket.emit('probe:sigkill');

		expect(exitStub.calledOnce).to.be.true;
	});
});
