import { expect } from 'chai';
import * as sinon from 'sinon';
import * as winston from 'winston';
import ApiLogsTransport, { type ApiTransportOptions } from '../../../src/lib/api-logs-transport.js';
import { Socket } from 'socket.io-client';
import { useSandboxWithFakeTimers } from '../../utils.js';

describe('ApiLogsTransport', () => {
	let sandbox: sinon.SinonSandbox;
	let socket: sinon.SinonStubbedInstance<Socket>;
	const timestamp = '2025-10-27 20:00:00 +01:00';
	const ACK_DELAY = 50;

	const setEmitWithAckResponse = (response: string) => {
		socket.emitWithAck.callsFake(() => {
			return new Promise((resolve) => {
				setTimeout(() => resolve(response), ACK_DELAY);
			});
		});
	};

	const createTransportAndLogger = (options: ApiTransportOptions) => {
		const transport = new ApiLogsTransport({ ...options, socket });
		const logger = winston.createLogger({ defaultMeta: { timestamp }, transports: [ transport ] });

		return { transport, logger };
	};

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers();
		socket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
		setEmitWithAckResponse('success');
		socket.connected = true;
	});

	afterEach(() => {
		sandbox.restore();
	});

	describe('constructor', () => {
		it('should set default options if none are provided', () => {
			const transport = new ApiLogsTransport();
			const { isActive, maxBufferSize, sendInterval } = transport.getCurrentSettings();

			expect(isActive).to.be.false;
			expect(maxBufferSize).to.equal(100);
			expect(sendInterval).to.equal(10000);
		});

		it('should set provided options', () => {
			const options = {
				isActive: true,
				maxBufferSize: 50,
				sendInterval: 5000,
			};
			const transport = new ApiLogsTransport(options);
			const { isActive, maxBufferSize, sendInterval } = transport.getCurrentSettings();

			expect(isActive).to.be.true;
			expect(maxBufferSize).to.equal(50);
			expect(sendInterval).to.equal(5000);
		});
	});

	describe('logging', () => {
		it('should emit "logged" event when a log is created', (done) => {
			const { transport, logger } = createTransportAndLogger({ isActive: true, sendInterval: 1000 });

			transport.on('logged', (info) => {
				expect(info).to.have.property('message', 'test log');
				expect(info).to.have.property('timestamp', timestamp);
				done();
			});

			logger.info('test log');
		});

		it('should handle buffer overflow by dropping oldest logs', async () => {
			const { transport, logger } = createTransportAndLogger({ maxBufferSize: 2, isActive: true, sendInterval: 1000 });

			transport.setSocket(socket);

			logger.info('log 1');
			logger.info('log 2');
			logger.info('log 3');

			await sandbox.clock.tickAsync(1000);

			expect(socket.emitWithAck.calledOnceWith('probe:logs')).to.be.true;
			const payload = socket.emitWithAck.firstCall.args[1];
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

			expect(socket.emitWithAck.called).to.be.false;
		});

		it('should not send logs if socket is not connected', async () => {
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval: 1000 });
			socket.connected = false;

			logger.info('test');
			await sandbox.clock.tickAsync(1000);

			expect(socket.emitWithAck.called).to.be.false;
		});

		it('should not send logs if buffer is empty', async () => {
			createTransportAndLogger({ isActive: true, sendInterval: 100 });
			await sandbox.clock.tickAsync(1000);
			expect(socket.emitWithAck.called).to.be.false;
		});

		it('should send logs and clear buffer', async () => {
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval: 100 });

			logger.info('test');
			await sandbox.clock.tickAsync(1000);

			expect(socket.emitWithAck.calledOnce).to.be.true;
			expect(socket.emitWithAck.firstCall.args[0]).to.equal('probe:logs');
			const payload = socket.emitWithAck.firstCall.args[1];
			expect(payload.logs).to.have.lengthOf(1);
			expect(payload.logs[0]).to.have.property('message', 'test');
			expect(payload.logs[0]).to.have.property('timestamp', new Date(timestamp).toISOString());
			expect(payload.skipped).to.equal(0);

			await sandbox.clock.tickAsync(1000);
			expect(socket.emitWithAck.calledOnce).to.be.true; // no new emits
		});

		it('should not indicate dropped logs if only sent logs are dropped before emit ack', async () => {
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval: 100, maxBufferSize: 3 });

			logger.info('test1');
			logger.info('test2');
			logger.info('test3');

			await sandbox.clock.tickAsync(100);
			expect(socket.emitWithAck.calledOnce).to.be.true;

			// waiting for ack
			logger.info('test4');
			logger.info('test5');

			await sandbox.clock.tickAsync(ACK_DELAY + 100);

			expect(socket.emitWithAck.calledTwice).to.be.true;
			let payload = socket.emitWithAck.secondCall.args[1];
			expect(payload.logs).to.have.lengthOf(2);
			expect(payload.logs[0]).to.have.property('message', 'test4');
			expect(payload.logs[1]).to.have.property('message', 'test5');
			expect(payload.skipped).to.equal(0);

			// waiting for ack
			logger.info('test6');

			await sandbox.clock.tickAsync(ACK_DELAY + 100);

			expect(socket.emitWithAck.calledThrice).to.be.true;
			payload = socket.emitWithAck.thirdCall.args[1];
			expect(payload.logs).to.have.lengthOf(1);
			expect(payload.logs[0]).to.have.property('message', 'test6');
			expect(payload.skipped).to.equal(0);
		});

		it('should calculate dropped logs correctly when unsent logs are dropped before emit ack', async () => {
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval: 100, maxBufferSize: 2 });

			logger.info('test1');
			logger.info('test2');

			await sandbox.clock.tickAsync(100);
			expect(socket.emitWithAck.calledOnce).to.be.true;

			// waiting for ack
			logger.info('test3');
			logger.info('test4');
			logger.info('test5');
			logger.info('test6');

			await sandbox.clock.tickAsync(100 + ACK_DELAY);
			expect(socket.emitWithAck.calledTwice).to.be.true;
			const payload = socket.emitWithAck.secondCall.args[1];
			expect(payload.logs).to.have.lengthOf(2);
			expect(payload.logs[0]).to.have.property('message', 'test5');
			expect(payload.logs[1]).to.have.property('message', 'test6');
			expect(payload.skipped).to.equal(2);
		});

		it('should resend logs if emit ack fails until success', async () => {
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval: 100, maxBufferSize: 2 });

			setEmitWithAckResponse('error');

			logger.info('test1');
			logger.info('test2');

			await sandbox.clock.tickAsync(100);
			expect(socket.emitWithAck.calledOnce).to.be.true;

			setEmitWithAckResponse('success');

			await sandbox.clock.tickAsync(100 + ACK_DELAY);
			expect(socket.emitWithAck.calledTwice).to.be.true;

			const payload = socket.emitWithAck.secondCall.args[1];
			expect(payload.logs).to.have.lengthOf(2);
			expect(payload.logs[0]).to.have.property('message', 'test1');
			expect(payload.logs[1]).to.have.property('message', 'test2');
			expect(payload.skipped).to.equal(0);

			// no subsequent emits
			await sandbox.clock.tickAsync(100 + ACK_DELAY);
			expect(socket.emitWithAck.calledTwice).to.be.true;
		});

		it('should drop old logs when emit fails', async () => {
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval: 100, maxBufferSize: 2 });

			setEmitWithAckResponse('error');

			logger.info('test1');
			logger.info('test2');

			await sandbox.clock.tickAsync(100);

			logger.info('test3');
			logger.info('test4');

			await sandbox.clock.tickAsync(100 + ACK_DELAY);

			setEmitWithAckResponse('success');

			await sandbox.clock.tickAsync(100 + ACK_DELAY);

			expect(socket.emitWithAck.calledThrice).to.be.true;
			const payload = socket.emitWithAck.secondCall.args[1];
			expect(payload.logs).to.have.lengthOf(2);
			expect(payload.logs[0]).to.have.property('message', 'test3');
			expect(payload.logs[1]).to.have.property('message', 'test4');
			expect(payload.skipped).to.equal(2);

			// no subsequent emits
			await sandbox.clock.tickAsync(2000);
			expect(socket.emitWithAck.calledThrice).to.be.true;
		});

		it('should trim long messages', async () => {
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval: 100 });

			const sent = '0'.repeat(ApiLogsTransport.MAX_MESSAGE_LEN + 10);
			const expected = sent.slice(0, ApiLogsTransport.MAX_MESSAGE_LEN - 3) + '...';

			logger.info(sent);

			await sandbox.clock.tickAsync(1000);

			const payload = socket.emitWithAck.firstCall.args[1];
			expect(payload.logs).to.have.lengthOf(1);
			expect(payload.logs[0]).to.have.property('message', expected);
		});

		it('should handle object logs', async () => {
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval: 100 });
			const obj = { test: 'test', arr: [ 1, 2, { x: 'abc' }] };

			logger.info(obj);
			logger.info('with message', obj);

			await sandbox.clock.tickAsync(1000);

			const payload = socket.emitWithAck.firstCall.args[1];
			expect(payload.logs).to.have.lengthOf(2);
			expect(payload.logs[0]).to.have.keys('message', 'level', 'scope', 'timestamp');
			expect(payload.logs[0]).to.have.property('message', `{ test: 'test', arr: [ 1, 2, { x: 'abc' } ] }`);
			expect(payload.logs[1]).to.have.keys('message', 'level', 'scope', 'timestamp');
			expect(payload.logs[1]).to.have.property('message', `with message\n{ test: 'test', arr: [ 1, 2, { x: 'abc' } ] }`);
		});

		it('should send logs periodically', async () => {
			const sendInterval = 5000;
			const { logger } = createTransportAndLogger({ isActive: true, sendInterval });

			logger.info('test');
			expect(socket.emitWithAck.called).to.be.false;

			await sandbox.clock.tickAsync(sendInterval);
			expect(socket.emitWithAck.calledOnce).to.be.true;

			logger.info('test 2');
			await sandbox.clock.tickAsync(sendInterval + ACK_DELAY);
			expect(socket.emitWithAck.calledTwice).to.be.true;
		});
	});

	describe('updateSettings', () => {
		it('should update settings and reset interval', async () => {
			const { transport, logger } = createTransportAndLogger({ isActive: false, sendInterval: 10000 });

			transport.updateSettings({ isActive: true, maxBufferSize: 10, sendInterval: 5000 });
			const { isActive, maxBufferSize, sendInterval } = transport.getCurrentSettings();

			expect(isActive).to.be.true;
			expect(maxBufferSize).to.equal(10);
			expect(sendInterval).to.equal(5000);

			logger.info('test');
			await sandbox.clock.tickAsync(5000);
			expect(socket.emitWithAck.calledOnce).to.be.true;
		});

		it('should only update provided settings', () => {
			const transport = new ApiLogsTransport({ isActive: false, maxBufferSize: 100, sendInterval: 10000 });

			transport.updateSettings({ isActive: true });
			const { isActive, maxBufferSize, sendInterval } = transport.getCurrentSettings();

			expect(isActive).to.be.true;
			expect(maxBufferSize).to.equal(100);
			expect(sendInterval).to.equal(10000);
		});

		it('should not emit after disabling sending', async () => {
			const { transport, logger } = createTransportAndLogger({ isActive: true, sendInterval: 10000 });

			logger.info('test');
			transport.updateSettings({ isActive: false });

			await sandbox.clock.tickAsync(10000);
			expect(socket.emitWithAck.called).to.be.false;
		});
	});
});
