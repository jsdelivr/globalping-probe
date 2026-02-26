import { expect } from 'chai';
import * as sinon from 'sinon';
import { Socket } from 'socket.io-client';
import * as td from 'testdouble';
import path from 'node:path';

describe('adoptionStatusHandler', () => {
	const startServerStub = sinon.stub();
	const stopServerStub = sinon.stub();
	const getLocalIpsStub = sinon.stub();

	let adoptionStatusHandler: any;
	let socket: sinon.SinonStubbedInstance<Socket>;
	let prevHwEnv: string | undefined;

	before(async () => {
		prevHwEnv = process.env['GP_HOST_HW'];

		const adoptionServerPath = path.resolve('src/lib/adoption-server.ts');
		const privateIpPath = path.resolve('src/lib/private-ip.ts');

		await td.replaceEsm(adoptionServerPath, {
			startLocalAdoptionServer: startServerStub,
			stopLocalAdoptionServer: stopServerStub,
		});

		await td.replaceEsm(privateIpPath, {
			getLocalIps: getLocalIpsStub,
		});

		({ adoptionStatusHandler } = await import('../../../src/helper/adoption-status-handler.js'));
	});

	beforeEach(() => {
		startServerStub.reset();
		stopServerStub.reset();
		getLocalIpsStub.reset();
		socket = sinon.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
	});

	afterEach(() => {
		process.env['GP_HOST_HW'] = prevHwEnv;
	});

	after(() => {
		td.reset();
	});

	describe('unadopted probe', () => {
		it('should start adoption server and emit ready event if GP_HOST_HW is set', async () => {
			process.env['GP_HOST_HW'] = 'true';

			const mockToken = 'mock-token';
			const mockExpiresAt = '2025-01-01T00:00:00.000Z';
			startServerStub.returns({ token: mockToken, expiresAt: mockExpiresAt });

			getLocalIpsStub.returns([
				'192.168.1.50',
				'10.0.0.5',
			]);

			const handler = adoptionStatusHandler(socket);
			await handler({ message: 'Not adopted', adopted: false });

			expect(startServerStub.calledOnce).to.be.true;
			expect(getLocalIpsStub.calledOnce).to.be.true;

			expect(socket.emit.calledOnceWith('probe:adoption:ready', {
				token: mockToken,
				expiresAt: mockExpiresAt,
				ips: [ '192.168.1.50', '10.0.0.5' ],
			})).to.be.true;
		});

		it('should limit the number of reported IPs to 32', async () => {
			process.env['GP_HOST_HW'] = 'true';
			startServerStub.returns({ token: 'abc', expiresAt: 'date' });
			getLocalIpsStub.returns(Array.from({ length: 40 }, (_, i) => `1.1.1.${i}`));

			const handler = adoptionStatusHandler(socket);
			await handler({ message: 'Not adopted', adopted: false });

			const payload = socket.emit.firstCall.args[1];
			expect(payload.ips).to.have.lengthOf(32);
		});

		it('should stop adoption server if GP_HOST_HW is NOT set', async () => {
			delete process.env['GP_HOST_HW'];

			const handler = adoptionStatusHandler(socket);
			await handler({ message: 'Not adopted', adopted: false });

			expect(startServerStub.called).to.be.false;
			expect(stopServerStub.calledOnce).to.be.true;
			expect(socket.emit.called).to.be.false;
		});
	});

	describe('adopted probe', () => {
		it('should stop adoption server, hw probe', async () => {
			process.env['GP_HOST_HW'] = 'true';

			const handler = adoptionStatusHandler(socket);
			await handler({ message: 'Adopted', adopted: true });

			expect(startServerStub.called).to.be.false;
			expect(stopServerStub.calledOnce).to.be.true;
			expect(socket.emit.called).to.be.false;
		});

		it('should stop adoption server, sw probe', async () => {
			delete process.env['GP_HOST_HW'];

			const handler = adoptionStatusHandler(socket);
			await handler({ message: 'Adopted', adopted: true });

			expect(startServerStub.called).to.be.false;
			expect(stopServerStub.calledOnce).to.be.true;
			expect(socket.emit.called).to.be.false;
		});
	});
});
