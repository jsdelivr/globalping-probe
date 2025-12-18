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

	const mockHttpResponse = (response: string[], options?: {
		address?: string;
		family?: number;
		hostname?: string;
		checkNetConnectOptions?: (options: any) => void;
	}) => {
		let request = '';
		const fakeSocket = new Duplex({
			read () {},
			write (chunk, _encoding, callback) {
				request += chunk.toString();
				callback();
			},
		});
		(fakeSocket as any).remoteAddress = options?.address || '127.0.0.1';

		netConnectStub.callsFake((connectOptions) => {
			if (options?.checkNetConnectOptions) {
				options.checkNetConnectOptions(connectOptions);
			}

			process.nextTick(() => {
				fakeSocket.emit('lookup', null, options?.address || '127.0.0.1', options?.family || 4, options?.hostname || 'google.com');
				fakeSocket.emit('connect');

				fakeSocket.push(response.join('\r\n'));
				fakeSocket.push(null);
			});

			return fakeSocket as any;
		});

		return { getRequest: () => request };
	};

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers({ useFakeTimers: { now: 0 } });
		mockedSocket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
		netConnectStub = sandbox.stub(net, 'connect');
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('should respond with 200', async () => {
		const mock = mockHttpResponse([
			'HTTP/1.1 200 OK',
			'test: abc',
			'Content-Length: 6',
			'',
			'200 Ok',
		], {
			checkNetConnectOptions: (options) => {
				expect(options).to.deep.include({ host: 'google.com', port: 80 });
			},
		});

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: true,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/200', query: 'abc=def' },
			ipVersion: 4,
		});

		expect(netConnectStub.calledOnce).to.be.true;

		expect(mock.getRequest()).to.equal([
			'GET /200?abc=def HTTP/1.1',
			'host: google.com',
			'connection: close',
			'Accept-Encoding: gzip, deflate, br, zstd',
			'User-Agent: globalping probe (https://github.com/jsdelivr/globalping)',
			'',
			'',
		].join('\r\n'));

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

	it('should handle HEAD request without body', async () => {
		const mock = mockHttpResponse([
			'HTTP/1.1 200 OK',
			'Content-Type: text/html',
			'',
			'',
		]);

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'HEAD', path: '/', query: '' },
			ipVersion: 4,
		});

		expect(mock.getRequest()).to.equal([
			'HEAD / HTTP/1.1',
			'host: google.com',
			'connection: close',
			'Accept-Encoding: gzip, deflate, br, zstd',
			'User-Agent: globalping probe (https://github.com/jsdelivr/globalping)',
			'',
			'',
		].join('\r\n'));

		expect(mockedSocket.emit.callCount).to.equal(1);
		expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.statusCode).to.equal(200);
		expect(result.rawBody).to.equal(null);
		expect(result.rawOutput).to.equal('HTTP/1.1 200\nContent-Type: text/html');
	});

	it('should handle 404 error', async () => {
		mockHttpResponse([
			'HTTP/1.1 404 Not Found',
			'Content-Type: text/plain',
			'Content-Length: 9',
			'',
			'Not Found',
		]);

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: true,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/notfound', query: '' },
			ipVersion: 4,
		});

		expect(mockedSocket.emit.callCount).to.equal(2);

		const result = mockedSocket.emit.lastCall.args[1].result;

		expect(result.status).to.equal('finished');
		expect(result.statusCode).to.equal(404);
		expect(result.statusCodeName).to.equal('Not Found');
		expect(result.rawBody).to.equal('Not Found');
		expect(result.rawOutput).to.equal('HTTP/1.1 404\nContent-Type: text/plain\nContent-Length: 9\n\nNot Found');
	});

	it('should handle 500 error', async () => {
		mockHttpResponse([
			'HTTP/1.1 500 Internal Server Error',
			'Content-Length: 21',
			'',
			'Internal Server Error',
		]);

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/error', query: '' },
			ipVersion: 4,
		});

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.status).to.equal('finished');
		expect(result.statusCode).to.equal(500);
		expect(result.statusCodeName).to.equal('Internal Server Error');
	});

	it('should handle specified headers', async () => {
		const mock = mockHttpResponse([
			'HTTP/1.1 200 OK',
			'Content-Type: text/html',
			'Content-Length: 5',
			'X-Custom: value',
			'Cache-Control: no-cache',
			'',
			'hello',
		]);

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: {
				method: 'GET',
				path: '/',
				query: '',
				headers: {
					'X-Custom-Header': 'test-value',
					'X-Another': 'another-value',
				},
			},
			ipVersion: 4,
		});

		expect(mock.getRequest()).to.equal([
			'GET / HTTP/1.1',
			'host: google.com',
			'connection: close',
			'Accept-Encoding: gzip, deflate, br, zstd',
			'X-Custom-Header: test-value',
			'X-Another: another-value',
			'User-Agent: globalping probe (https://github.com/jsdelivr/globalping)',
			'',
			'',
		].join('\r\n'));

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.headers).to.deep.equal({
			'content-type': 'text/html',
			'content-length': '5',
			'x-custom': 'value',
			'cache-control': 'no-cache',
		});

		expect(result.rawHeaders).to.include('Content-Type: text/html');
		expect(result.rawHeaders).to.include('X-Custom: value');
	});

	it('should send custom headers', async () => {
		const mock = mockHttpResponse([
			'HTTP/1.1 200 OK',
			'',
			'',
		], {
			hostname: 'api.example.com',
		});

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'api.example.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: {
				method: 'GET',
				path: '/api',
				query: '',
				headers: {
					'Authorization': 'Bearer token123',
					'X-Custom-Header': 'custom-value',
				},
			},
			ipVersion: 4,
		});

		const request = mock.getRequest();

		expect(request).to.include('Authorization: Bearer token123');
		expect(request).to.include('X-Custom-Header: custom-value');
	});

	it('should handle custom port', async () => {
		const mock = mockHttpResponse([
			'HTTP/1.1 200 OK',
			'',
			'',
		], {
			address: '203.0.113.50',
			hostname: 'api.example.com',
			checkNetConnectOptions: (options) => {
				expect(options.host).to.equal('api.example.com');
				expect(options.port).to.equal(8080);
			},
		});

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'api.example.com',
			port: 8080,
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/api/v1', query: '' },
			ipVersion: 4,
		});

		expect(mock.getRequest()).to.equal([
			'GET /api/v1 HTTP/1.1',
			'host: api.example.com',
			'connection: close',
			'Accept-Encoding: gzip, deflate, br, zstd',
			'User-Agent: globalping probe (https://github.com/jsdelivr/globalping)',
			'',
			'',
		].join('\r\n'));

		expect(netConnectStub.calledOnce).to.be.true;

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.resolvedAddress).to.equal('203.0.113.50');
		expect(result.statusCode).to.equal(200);
	});

	it('should handle OPTIONS request', async () => {
		const mock = mockHttpResponse([
			'HTTP/1.1 200 OK',
			'Allow: GET, HEAD, OPTIONS',
			'',
			'',
		], {
			hostname: 'api.example.com',
		});

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'api.example.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'OPTIONS', path: '/api', query: '' },
			ipVersion: 4,
		});

		expect(mock.getRequest()).to.include('OPTIONS /api HTTP/1.1');

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.statusCode).to.equal(200);
		expect(result.headers['allow']).to.equal('GET, HEAD, OPTIONS');
	});

	it('should handle IPv6 address', async () => {
		mockHttpResponse([
			'HTTP/1.1 200 OK',
			'',
			'',
		], {
			address: '2606:4700:4700::1111',
			family: 6,
			hostname: '2606:4700:4700::1111',
			checkNetConnectOptions: (options) => {
				expect(options.host).to.equal('2606:4700:4700::1111');
				expect(options.family).to.equal(6);
			},
		});

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: '2606:4700:4700::1111',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/', query: '' },
			ipVersion: 6,
		});

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.resolvedAddress).to.equal('2606:4700:4700::1111');
	});
});

