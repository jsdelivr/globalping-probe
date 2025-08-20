import { expect } from 'chai';
import * as sinon from 'sinon';
import * as winston from 'winston';
import ApiTransport, { type ApiTransportOptions } from '../../../src/lib/api-transport.js';
import { Socket } from 'socket.io-client';
import { useSandboxWithFakeTimers } from '../../utils.js';

describe('ApiTransport', () => {
	let sandbox: sinon.SinonSandbox;
	let socket: sinon.SinonStubbedInstance<Socket>;

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers();
		socket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
		socket.connected = true;
	});

	afterEach(() => {
		sandbox.restore();
	});

	const createTransportAndLogger = (options: ApiTransportOptions) => {
		const transport = new ApiTransport({ ...options, socket });
		const logger = winston.createLogger({ transports: [ transport ] });

		return { transport, logger };
	};

	describe('constructor', () => {
		it('should set default options if none are provided', () => {
			const transport = new ApiTransport();
			const { sendingEnabled, bufferSize, sendInterval } = transport.getCurrentSettings();

			expect(sendingEnabled).to.be.false;
			expect(bufferSize).to.equal(100);
			expect(sendInterval).to.equal(10000);
		});

		it('should set provided options', () => {
			const options = {
				sendingEnabled: true,
				bufferSize: 50,
				sendInterval: 5000,
			};
			const transport = new ApiTransport(options);
			const { sendingEnabled, bufferSize, sendInterval } = transport.getCurrentSettings();

			expect(sendingEnabled).to.be.true;
			expect(bufferSize).to.equal(50);
			expect(sendInterval).to.equal(5000);
		});
	});

	describe('logging', () => {
		it('should emit "logged" event when a log is created', (done) => {
			const { transport, logger } = createTransportAndLogger({ sendingEnabled: true, sendInterval: 1000 });

			transport.on('logged', (info) => {
				expect(info).to.have.property('message', 'test log');
				done();
			});

			logger.info('test log');
		});

		it('should handle buffer overflow by dropping oldest logs', async () => {
			const { transport, logger } = createTransportAndLogger({ bufferSize: 2, sendingEnabled: true, sendInterval: 1000 });

			transport.socket = socket;

			logger.info('log 1');
			logger.info('log 2');
			logger.info('log 3');

			await sandbox.clock.tickAsync(1000);

			expect(socket.emit.calledOnceWith('probe:logs')).to.be.true;
			const payload = socket.emit.firstCall.args[1];
			expect(payload.logs).to.have.lengthOf(2);
			expect(payload.logs[0]).to.have.property('message', 'log 2');
			expect(payload.logs[1]).to.have.property('message', 'log 3');
			expect(payload.skipped).to.equal(1);
		});
	});

	describe('sending logs', () => {
		it('should not send logs if sending is disabled', async () => {
			const { logger } = createTransportAndLogger({ sendInterval: 1000 });

			logger.info('test');
			await sandbox.clock.tickAsync(1000);

			expect(socket.emit.called).to.be.false;
		});

		it('should not send logs if socket is not connected', async () => {
			const { logger } = createTransportAndLogger({ sendingEnabled: true, sendInterval: 1000 });
			socket.connected = false;

			logger.info('test');
			await sandbox.clock.tickAsync(1000);

			expect(socket.emit.called).to.be.false;
		});

		it('should not send logs if buffer is empty', async () => {
			createTransportAndLogger({ sendingEnabled: true, sendInterval: 100 });
			await sandbox.clock.tickAsync(1000);
			expect(socket.emit.called).to.be.false;
		});

		it('should send logs and clear buffer', async () => {
			const { logger } = createTransportAndLogger({ sendingEnabled: true, sendInterval: 100 });

			logger.info('test');
			await sandbox.clock.tickAsync(1000);

			expect(socket.emit.calledOnce).to.be.true;
			expect(socket.emit.firstCall.args[0]).to.equal('probe:logs');
			const payload = socket.emit.firstCall.args[1];
			expect(payload.logs).to.have.lengthOf(1);
			expect(payload.logs[0]).to.have.property('message', 'test');
			expect(payload.skipped).to.equal(0);

			await sandbox.clock.tickAsync(1000);
			expect(socket.emit.calledOnce).to.be.true; // no new emits
		});

		it('should send logs periodically', async () => {
			const sendInterval = 5000;
			const { logger } = createTransportAndLogger({ sendingEnabled: true, sendInterval });

			logger.info('test');
			expect(socket.emit.called).to.be.false;

			await sandbox.clock.tickAsync(sendInterval);
			expect(socket.emit.calledOnce).to.be.true;

			logger.info('test 2');
			await sandbox.clock.tickAsync(sendInterval);
			expect(socket.emit.calledTwice).to.be.true;
		});
	});

	describe('updateSettings', () => {
		it('should update settings and reset interval', async () => {
			const { transport, logger } = createTransportAndLogger({ sendingEnabled: false, sendInterval: 10000 });

			transport.updateSettings({ enabled: true, bufferSize: 10, sendInterval: 5000 });
			const { sendingEnabled, bufferSize, sendInterval } = transport.getCurrentSettings();

			expect(sendingEnabled).to.be.true;
			expect(bufferSize).to.equal(10);
			expect(sendInterval).to.equal(5000);

			logger.info('test');
			await sandbox.clock.tickAsync(5000);
			expect(socket.emit.calledOnce).to.be.true;
		});

		it('should only update provided settings', () => {
			const transport = new ApiTransport({ sendingEnabled: false, bufferSize: 100, sendInterval: 10000 });

			transport.updateSettings({ enabled: true });
			const { sendingEnabled, bufferSize, sendInterval } = transport.getCurrentSettings();

			expect(sendingEnabled).to.be.true;
			expect(bufferSize).to.equal(100);
			expect(sendInterval).to.equal(10000);
		});

		it('should not emit after disabling sending', async () => {
			const { transport, logger } = createTransportAndLogger({ sendingEnabled: false, sendInterval: 10000 });

			transport.updateSettings({ enabled: false });

			logger.info('test');
			await sandbox.clock.tickAsync(10000);
			expect(socket.emit.called).to.be.false;
		});
	});
});
