import { Duplex } from 'node:stream';
import net from 'node:net';
import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import { HttpCommand } from '../../../src/command/http-command.js';
import { useSandboxWithFakeTimers } from '../../utils.js';

describe('new http command', () => {
	let sandbox: sinon.SinonSandbox;
	let mockedSocket: sinon.SinonStubbedInstance<Socket>;
	let netConnectStub: sinon.SinonStub;

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers({ useFakeTimers: { now: 0 } });
		mockedSocket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
		netConnectStub = sandbox.stub(net, 'connect');
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('should respond with 200', async () => {
		const fakeSocket = new Duplex({
			read () {},
			write (_chunk, _encoding, callback) { callback(); },
		});
		(fakeSocket as any).remoteAddress = '127.0.0.1';

		netConnectStub.callsFake(() => {
			process.nextTick(() => {
				fakeSocket.emit('lookup', null, '127.0.0.1', 4, 'google.com');
				fakeSocket.emit('connect');
				fakeSocket.push('HTTP/1.1 200 OK\r\ntest: abc\r\nContent-Length: 6\r\n\r\n200 Ok');
				fakeSocket.push(null);
			});

			return fakeSocket as any;
		});

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: true,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/200', query: 'abc=def' },
			ipVersion: 4,
		});

		expect(mockedSocket.emit.callCount).to.equal(2);

		expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:progress', {
			testId: 'test',
			measurementId: 'measurement',
			overwrite: false,
			result: {
				rawHeaders: 'test: abc\nContent-Length: 6',
				rawBody: '200 Ok',
				rawOutput: 'HTTP/1.1 200\ntest: abc\nContent-Length: 6\n\n200 Ok',
			},
		}]);

		expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', {
			testId: 'test',
			measurementId: 'measurement',
			result: {
				status: 'finished',
				resolvedAddress: '127.0.0.1',
				headers: { 'test': 'abc', 'content-length': '6' },
				rawHeaders: 'test: abc\nContent-Length: 6',
				rawBody: '200 Ok',
				rawOutput: 'HTTP/1.1 200\ntest: abc\nContent-Length: 6\n\n200 Ok',
				truncated: false,
				statusCode: 200,
				statusCodeName: 'OK',
				timings: { total: 0, download: 0, firstByte: 0, dns: 0, tls: null, tcp: 0 },
				tls: null,
			},
		}]);
	});
});

