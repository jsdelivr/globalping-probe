/* eslint-disable quote-props */
import process from 'node:process';
import { expect } from 'chai';
import * as td from 'testdouble';
import * as sinon from 'sinon';
import { getCmdMock, MockSocket } from '../utils.js';
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
	const runStub = sinon.stub();
	const PingCommandStub = sinon.stub().returns({
		run: runStub,
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
	});

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true });
	});

	afterEach(() => {
		execaStub.reset();
		runStub.reset();

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
		await import('../../src/index.js');
		mockSocket.emit('connect');
		await sandbox.clock.nextAsync();

		mockSocket.emit('probe:measurement:request', { id: '123', measurement: { type: 'ping' } });

		expect((execaStub.firstCall.args[0] as string).endsWith('/src/sh/unbuffer.sh')).to.be.true;
		expect(initStatusManagerStub.callCount).to.equal(1);
		expect(handlers['probe:measurement:ack'].notCalled).to.be.true;
		expect(runStub.notCalled).to.be.true;
	});

	it('should initialize and connect to the API server', async () => {
		await import('../../src/index.js');
		mockSocket.emit('connect');
		mockSocket.emit('api:connect:location', fakeLocation);

		await sandbox.clock.nextAsync();

		expect(ioStub.calledOnce).to.be.true;
		expect(ioStub.firstCall.args[0]).to.equal('ws://api.globalping.io/probes');

		expect(ioStub.firstCall.args[1]).to.deep.include({
			transports: [ 'websocket' ],
			reconnectionDelay: 100,
			reconnectionDelayMax: 500,
		});

		expect(ioStub.firstCall.args[1].query.version).to.match(/^\d+.\d+.\d+$/);
		expect(ioStub.firstCall.args[1].query.nodeVersion).to.match(/^v\d+.\d+.\d+$/);

		expect(statusManagerStub.sendStatus.callCount).to.equal(1);
		expect(initStatusManagerStub.callCount).to.equal(1);
		expect(initStatusManagerStub.firstCall.args).to.deep.equal([ mockSocket, pingCmdStub ]);
		expect(handlers['probe:dns:update'].calledOnce).to.be.true;
	});

	it('should disconnect on "connect_error"', async () => {
		const exitStub = sandbox.stub(process, 'exit');

		await import('../../src/index.js');
		mockSocket.emit('connect_error', new Error());
		mockSocket.emit('connect_error', { message: 'failed to collect probe metadata' });
		mockSocket.emit('connect_error', { message: 'vpn detected' });

		expect(disconnectStub.callCount).to.equal(3);
		expect(exitStub.notCalled).to.be.true;
	});

	it('should exit on "connect_error" for invalid probe version', async () => {
		const exitStub = sandbox.stub(process, 'exit');

		await import('../../src/index.js');
		mockSocket.emit('connect_error', { message: 'invalid probe version' });

		expect(exitStub.calledOnce).to.be.true;
	});

	it('should start measurement request', async () => {
		await import('../../src/index.js');
		mockSocket.emit('connect');
		mockSocket.emit('api:connect:location', fakeLocation);
		await sandbox.clock.nextAsync();

		mockSocket.emit('probe:measurement:request', { measurementId: 'measurementid', testId: 'testid', measurement: { type: 'ping' } });

		expect(PingCommandStub.calledOnce).to.be.true;
		expect(PingCommandStub.firstCall.args[0]).to.equal(pingCmdStub);
		expect(handlers['probe:measurement:ack'].calledOnce).to.be.true;
		expect(runStub.calledOnce).to.be.true;
		expect(runStub.firstCall.args[0]).to.equal(mockSocket);
		expect(runStub.firstCall.args[1]).to.equal('measurementid');
		expect(runStub.firstCall.args[2]).to.equal('testid');
		expect(runStub.firstCall.args[3]).to.deep.equal({ type: 'ping' });
	});

	it('should reconnect on "disconnect" event from API', async () => {
		await import('../../src/index.js');

		mockSocket.emit('disconnect');
		expect(connectStub.notCalled).to.be.true;
		mockSocket.emit('disconnect', 'io server disconnect');
		expect(connectStub.calledOnce).to.be.true;
	});

	it('should reconnect after 1 hour delay on "probe" type errors', async () => {
		await import('../../src/index.js');

		mockSocket.emit('connect_error', new Error('ip limit'));
		mockSocket.emit('connect_error', new Error('vpn detected'));
		mockSocket.emit('connect_error', new Error('unresolvable geoip'));

		sandbox.clock.tick(60 * 1000 + 50);
		expect(connectStub.callCount).to.equal(0);
		sandbox.clock.tick(60 * 60 * 1000 + 50);
		expect(connectStub.callCount).to.equal(3);
	});

	it('should reconnect after 1 minute delay on "api" type errors', async () => {
		await import('../../src/index.js');

		mockSocket.emit('connect_error', new Error('failed to collect probe metadata'));

		sandbox.clock.tick(1000 + 50);
		expect(connectStub.callCount).to.equal(0);
		sandbox.clock.tick(60 * 1000 + 50);
		expect(connectStub.callCount).to.equal(1);
	});

	it('should reconnect after 1 second delay on "connect_error" with other messages', async () => {
		await import('../../src/index.js');

		mockSocket.emit('connect_error', new Error('some message'));

		expect(connectStub.callCount).to.equal(0);
		sandbox.clock.tick(1000 + 50);
		expect(connectStub.callCount).to.equal(1);
	});

	it('should exit on SIGTERM if there are no active measurements', async () => {
		const exitStub = sandbox.stub(process, 'exit');
		await import('../../src/index.js');

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
		await import('../../src/index.js');
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

		await import('../../src/index.js');
		mockSocket.emit('probe:sigkill');

		expect(exitStub.calledOnce).to.be.true;
	});
});
