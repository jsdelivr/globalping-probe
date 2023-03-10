/* eslint-disable quote-props */
import process from 'node:process';
import {expect} from 'chai';
import * as td from 'testdouble';
import * as sinon from 'sinon';
import {MockSocket} from '../utils.js';

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
	const pingCmdStub = sinon.stub();

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
	for (const [event, handler] of Object.entries(handlers)) {
		mockSocket.on(event, handler);
	}

	mockSocket.connect = connectStub;
	mockSocket.disconnect = disconnectStub;
	const ioStub = sinon.stub().returns(mockSocket);

	before(async () => {
		await td.replaceEsm('execa', {execa: execaStub});
		await td.replaceEsm('socket.io-client', {io: ioStub});
		await td.replaceEsm('../../src/command/ping-command.ts', {PingCommand: PingCommandStub, pingCmd: pingCmdStub});
	});

	beforeEach(() => {
		sandbox = sinon.createSandbox({useFakeTimers: true});
	});

	afterEach(() => {
		execaStub.reset();
		runStub.reset();
		for (const stub of Object.values(handlers)) {
			stub.reset();
		}

		disconnectStub.reset();
		sandbox.restore();
	});

	after(() => {
		td.reset();
		process.removeAllListeners('SIGTERM');
	});

	it('should initialize and connect to the API server', async () => {
		await import('../../src/index.js');
		mockSocket.emit('api:connect:location', fakeLocation);

		expect((execaStub.firstCall.args[0] as string).endsWith('/src/sh/unbuffer.sh')).to.be.true;
		expect(ioStub.calledOnce).to.be.true;
		expect(ioStub.firstCall.args[0]).to.equal('ws://api.globalping.io/probes');
		expect(ioStub.firstCall.args[1]).to.deep.include({
			transports: ['websocket'],
			reconnectionDelay: 100,
			reconnectionDelayMax: 500,
		});
		expect(execaStub.secondCall.args).to.deep.equal(['which', ['unbuffer']]);
		await sandbox.clock.nextAsync();
		expect(handlers['probe:status:update'].callCount).to.equal(1);
		expect(handlers['probe:status:update'].firstCall.args).to.deep.equal(['ready']);
		expect(handlers['probe:dns:update'].calledOnce).to.be.true;
	});

	it('should disconnect on "connect_error" for fatal errors', async () => {
		const exitStub = sandbox.stub(process, 'exit');

		await import('../../src/index.js');
		mockSocket.emit('connect_error', {message: 'failed to collect probe metadata'});
		mockSocket.emit('connect_error', {message: 'vpn detected'});

		expect(disconnectStub.callCount).to.equal(2);
		expect(exitStub.notCalled).to.be.true;
	});

	it('should exit onn "connect_error" for invalid probe version', async () => {
		const exitStub = sandbox.stub(process, 'exit');

		await import('../../src/index.js');
		mockSocket.emit('connect_error', {message: 'invalid probe version'});

		expect(disconnectStub.notCalled).to.be.true;
		expect(exitStub.calledOnce).to.be.true;
	});

	it('should ignore measurement request if not connected', async () => {
		await import('../../src/index.js');
		mockSocket.emit('probe:measurement:request', {id: '123', measurement: {type: 'ping'}});

		expect(handlers['probe:measurement:ack'].notCalled).to.be.true;
		expect(runStub.notCalled).to.be.true;
	});

	it('should start measurement request', async () => {
		await import('../../src/index.js');
		mockSocket.emit('connect');
		mockSocket.emit('probe:measurement:request', {id: '123', measurement: {type: 'ping'}});

		expect(PingCommandStub.calledOnce).to.be.true;
		expect(PingCommandStub.firstCall.args[0]).to.equal(pingCmdStub);
		expect(handlers['probe:measurement:ack'].calledOnce).to.be.true;
		expect(runStub.calledOnce).to.be.true;
		expect(runStub.firstCall.args[0]).to.equal(mockSocket);
		expect(runStub.firstCall.args[1]).to.equal('123');
		expect(runStub.firstCall.args[2]).to.be.a('string');
		expect(runStub.firstCall.args[3]).to.deep.equal({type: 'ping'});
	});

	it('should disconnect on "disconnect" event from API', async () => {
		await import('../../src/index.js');

		mockSocket.emit('disconnect');
		expect(connectStub.notCalled).to.be.true;
		mockSocket.emit('disconnect', 'io server disconnect');
		expect(connectStub.calledOnce).to.be.true;
	});

	it('should exit on SIGTERM if there are no active measurements', async () => {
		const exitStub = sandbox.stub(process, 'exit');
		await import('../../src/index.js');

		process.once('SIGTERM', () => {
			sandbox.clock.tick(150);
			expect(handlers['probe:status:update'].calledOnce).to.be.true;
			expect(handlers['probe:status:update'].firstCall.args).to.deep.equal(['sigterm']);
			expect(exitStub.calledOnce).to.be.true;
		});

		process.emit('SIGTERM');
	});

	it('should exit on SIGTERM if there are active measurements', async () => {
		const exitStub = sandbox.stub(process, 'exit');
		await import('../../src/index.js');
		mockSocket.emit('connect');
		mockSocket.emit('probe:measurement:request', {id: '123', measurement: {type: 'ping'}});

		process.once('SIGTERM', () => {
			sandbox.clock.tick(60_500);
			expect(handlers['probe:status:update'].calledOnce).to.be.true;
			expect(handlers['probe:status:update'].firstCall.args).to.deep.equal(['sigterm']);
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
