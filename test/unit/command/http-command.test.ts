import { expect } from 'chai';
import { Duplex } from 'node:stream';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import * as sinon from 'sinon';
import { Socket } from 'socket.io-client';
import { HttpCommand } from '../../../src/command/http-command.js';
import { HttpHandler } from '../../../src/command/handlers/http/undici.js';
import { useSandboxWithFakeTimers } from '../../utils.js';

describe('url builder', () => {
	const buffer = {} as any;

	describe('prefix', () => {
		it('should set http:// prefix (HTTP)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/');
		});

		it('should set https:// prefix (HTTPS)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTPS',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('https://google.com:443/');
		});

		it('should set https:// prefix (HTTP2)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP2',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('https://google.com:443/');
		});
	});

	describe('target', () => {
		it('should enclose an IPv6 address in brackets', () => {
			const options = {
				type: 'http' as const,
				target: '2606:4700:4700::1111',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://[2606:4700:4700::1111]:80/');
		});

		it('should not enclose an IPv4 address in brackets', () => {
			const options = {
				type: 'http' as const,
				target: '1.1.1.1',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://1.1.1.1:80/');
		});
	});

	describe('port', () => {
		it('should set custom port', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				port: 1212,
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:1212/');
		});

		it('should set default HTTP port', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/');
		});

		it('should set default HTTPS port', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTPS',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('https://google.com:443/');
		});
	});

	describe('path', () => {
		it('should prefix pathname with (/) sign', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: 'abc',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/abc');
		});

		it('should append pathname at the end of url (prevent double /)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/abc',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/abc');
		});
	});

	describe('query', () => {
		it('should prefix query with (?) sign', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: 'abc=def',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/?abc=def');
		});

		it('should append query at the end of url (prevent double ?)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '?abc=def',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new HttpHandler(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/?abc=def');
		});
	});
});

describe(`.run() method`, () => {
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
		(fakeSocket as any).remoteAddress = options?.address || '93.184.216.34';

		netConnectStub.callsFake((connectOptions) => {
			options?.checkNetConnectOptions?.(connectOptions);

			process.nextTick(() => {
				fakeSocket.emit('lookup', null, options?.address || '93.184.216.34', options?.family || 4, options?.hostname || 'google.com');
				sandbox.clock.tick(10);
				fakeSocket.emit('connect');
				sandbox.clock.tick(15);

				fakeSocket.push(response.join('\r\n'));
				fakeSocket.push(null);
			});

			return fakeSocket as any;
		});

		return { getRequest: () => request };
	};

	const mockHttpsResponse = (response: string[], options?: { address?: string }) => {
		let request = '';
		const tcpSocket = new Duplex({
			read () {},
			write (chunk, _encoding, callback) {
				request += chunk.toString();
				callback();
			},
		});
		(tcpSocket as any).remoteAddress = options?.address || '93.184.216.34';

		netConnectStub.callsFake((connectOptions) => {
			expect(connectOptions).to.deep.include({ host: 'example.com', port: 443 });

			process.nextTick(() => {
				tcpSocket.emit('lookup', null, options?.address || '93.184.216.34', 4, 'example.com');
				sandbox.clock.tick(10);
				tcpSocket.emit('connect');
			});

			return tcpSocket as any;
		});

		const tlsSocket = new Duplex({
			read () {},
			write (chunk, _encoding, callback) {
				request += chunk.toString();
				callback();
			},
		});

		(tlsSocket as any).authorized = true;
		(tlsSocket as any).authorizationError = null;
		(tlsSocket as any).alpnProtocol = 'http/1.1';
		(tlsSocket as any).getProtocol = () => 'TLSv1.3';
		(tlsSocket as any).getCipher = () => ({ name: 'TLS_AES_256_GCM_SHA384' });

		(tlsSocket as any).getPeerCertificate = () => ({
			valid_from: 'Dec 1 00:00:00 2023 GMT',
			valid_to: 'Dec 1 23:59:59 2024 GMT',
			issuer: { C: 'US', O: 'DigiCert Inc', CN: 'DigiCert TLS RSA SHA256 2020 CA1' },
			subject: { CN: 'example.com' },
			subjectaltname: 'DNS:example.com, DNS:www.example.com',
			serialNumber: 'ABC123',
			fingerprint256: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
			bits: 2048,
			modulus: 'dummy',
			exponent: '0x10001',
			pubkey: Buffer.from('3082010a0282010100', 'hex'),
		});

		const tlsConnectStub = sandbox.stub(tls, 'connect');

		tlsConnectStub.callsFake(() => {
			process.nextTick(() => {
				sandbox.clock.tick(20);
				tlsSocket.emit('secureConnect');
				sandbox.clock.tick(5);
				tlsSocket.push(response.join('\r\n'));
				tlsSocket.push(null);
			});

			return tlsSocket as any;
		});

		return { getRequest: () => request, tlsConnectStub };
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

		expect(mock.getRequest()).to.include('GET /200?abc=def HTTP/1.1');
		expect(mock.getRequest()).to.include('host: google.com');
		expect(mock.getRequest()).to.include('connection: close');
		expect(mock.getRequest()).to.include('accept-encoding: gzip, deflate, br');
		expect(mock.getRequest()).to.include('user-agent: globalping probe (https://github.com/jsdelivr/globalping)');

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
				resolvedAddress: '93.184.216.34',
				headers: { 'test': 'abc', 'content-length': '6' },
				rawHeaders: 'test: abc\nContent-Length: 6',
				rawBody: '200 Ok',
				rawOutput: 'HTTP/1.1 200\ntest: abc\nContent-Length: 6\n\n200 Ok',
				truncated: false,
				statusCode: 200,
				statusCodeName: 'OK',
				timings: { total: 25, download: 0, firstByte: 15, dns: 0, tls: null, tcp: 10 },
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

		expect(mock.getRequest()).to.include('HEAD / HTTP/1.1');
		expect(mock.getRequest()).to.include('host: google.com');
		expect(mock.getRequest()).to.include('connection: close');
		expect(mock.getRequest()).to.include('accept-encoding: gzip, deflate, br');
		expect(mock.getRequest()).to.include('user-agent: globalping probe (https://github.com/jsdelivr/globalping)');

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
					'accept-encoding': 'winrar',
					'user-agent': 'chrome',
				},
			},
			ipVersion: 4,
		});

		expect(mock.getRequest()).to.include('GET / HTTP/1.1');
		expect(mock.getRequest()).to.include('host: google.com');
		expect(mock.getRequest()).to.include('connection: close');
		expect(mock.getRequest()).to.include('accept-encoding: winrar');
		expect(mock.getRequest()).to.include('x-custom-header: test-value');
		expect(mock.getRequest()).to.include('x-another: another-value');
		expect(mock.getRequest()).to.include('user-agent: globalping probe (https://github.com/jsdelivr/globalping)');

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

		expect(request).to.include('authorization: Bearer token123');
		expect(request).to.include('x-custom-header: custom-value');
	});

	it('should handle custom port', async () => {
		const mock = mockHttpResponse([
			'HTTP/1.1 200 OK',
			'',
			'',
		], {
			address: '93.184.216.34',
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

		expect(mock.getRequest()).to.include('GET /api/v1 HTTP/1.1');
		expect(mock.getRequest()).to.include('host: api.example.com');
		expect(mock.getRequest()).to.include('connection: close');
		expect(mock.getRequest()).to.include('accept-encoding: gzip, deflate, br');
		expect(mock.getRequest()).to.include('user-agent: globalping probe (https://github.com/jsdelivr/globalping)');

		expect(netConnectStub.calledOnce).to.be.true;

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.resolvedAddress).to.equal('93.184.216.34');
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

	it('should handle HTTPS with TLS certificate', async () => {
		const mock = mockHttpsResponse([
			'HTTP/1.1 200 OK',
			'Content-Type: text/html',
			'',
			'',
		], {
			address: '93.184.216.34',
		});

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'example.com',
			inProgressUpdates: false,
			protocol: 'HTTPS',
			request: { method: 'GET', path: '/', query: '' },
			ipVersion: 4,
		});

		expect(netConnectStub.calledOnce).to.be.true;
		expect(mock.tlsConnectStub.calledOnce).to.be.true;

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.statusCode).to.equal(200);
		expect(result.resolvedAddress).to.equal('93.184.216.34');

		expect(result.tls).to.deep.equal({
			authorized: true,
			protocol: 'TLSv1.3',
			cipherName: 'TLS_AES_256_GCM_SHA384',
			createdAt: '2023-12-01T00:00:00.000Z',
			expiresAt: '2024-12-01T23:59:59.000Z',
			issuer: {
				C: 'US',
				O: 'DigiCert Inc',
				CN: 'DigiCert TLS RSA SHA256 2020 CA1',
			},
			subject: { CN: 'example.com', alt: 'DNS:example.com, DNS:www.example.com' },
			keyType: 'RSA',
			keyBits: 2048,
			serialNumber: 'AB:C1:23',
			fingerprint256: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
			publicKey: '30:82:01:0A:02:82:01:01:00',
		});
	});

	it('should fail when HTTP/2 is requested but server does not support it', async () => {
		const tcpSocket = new Duplex({
			read () {},
			write (_chunk, _encoding, callback) {
				callback();
			},
		});
		(tcpSocket as any).remoteAddress = '93.184.216.34';

		netConnectStub.callsFake(() => {
			process.nextTick(() => {
				tcpSocket.emit('lookup', null, '93.184.216.34', 4, 'example.com');
				tcpSocket.emit('connect');
			});

			return tcpSocket as any;
		});

		const tlsConnectStub = sandbox.stub(tls, 'connect').callsFake((() => {
			const tlsSocket = new Duplex({
				read () {},
				write (_chunk, _encoding, callback) {
					callback();
				},
			});

			(tlsSocket as any).alpnProtocol = 'http/1.1';

			(tlsSocket as any).destroy = () => {};

			(tlsSocket as any).getPeerCertificate = () => ({});

			process.nextTick(() => {
				tlsSocket.emit('secureConnect');
			});

			return tlsSocket as any;
		}) as any);

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'example.com',
			inProgressUpdates: false,
			protocol: 'HTTP2',
			request: { method: 'GET', path: '/', query: '' },
			ipVersion: 4,
		});

		expect(tlsConnectStub.calledOnce).to.be.true;

		const lastCall = mockedSocket.emit.lastCall;
		expect(lastCall.args[0]).to.equal('probe:measurement:result');
		const result = lastCall.args[1].result;

		expect(result.status).to.equal('failed');
		expect(result.rawOutput).to.equal('HTTP/2 is not supported by the server.');
	});

	it('should truncate response body when exceeds download limit', async () => {
		const largeBody = 'x'.repeat(15000);

		mockHttpResponse([
			'HTTP/1.1 200 OK',
			'Content-Type: text/plain',
			`Content-Length: ${largeBody.length}`,
			'',
			largeBody,
		]);

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/large', query: '' },
			ipVersion: 4,
		});

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.status).to.equal('finished');
		expect(result.statusCode).to.equal(200);
		expect(result.truncated).to.be.true;
		expect(result.rawBody).to.have.lengthOf(10000);
		expect(result.rawBody).to.equal('x'.repeat(10000));
	});

	it('should timeout after 10 seconds', async () => {
		const fakeSocket = new Duplex({
			read () {},
			write (_chunk, _encoding, callback) {
				callback();
			},
		});
		(fakeSocket as any).remoteAddress = '93.184.216.34';

		netConnectStub.callsFake(() => {
			process.nextTick(() => {
				fakeSocket.emit('lookup', null, '93.184.216.34', 4, 'google.com');
				fakeSocket.emit('connect');
			});

			return fakeSocket as any;
		});

		const promise = new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/timeout', query: '' },
			ipVersion: 4,
		});

		sandbox.clock.tick(10_001);

		await promise;

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.status).to.equal('failed');
		expect(result.rawOutput).to.equal('Request timeout.');
		expect(result.timings.total).to.be.null;
	});

	it('should decompress gzip response', async () => {
		const originalText = 'This is a test gzip compressed response body';
		const compressedBody = zlib.gzipSync(originalText);

		const fakeSocket = new Duplex({
			read () {},
			write (_chunk, _encoding, callback) {
				callback();
			},
		});
		(fakeSocket as any).remoteAddress = '93.184.216.34';

		netConnectStub.callsFake(() => {
			process.nextTick(() => {
				fakeSocket.emit('lookup', null, '93.184.216.34', 4, 'google.com');
				fakeSocket.emit('connect');

				const headers = [
					'HTTP/1.1 200 OK',
					'Content-Type: text/plain',
					'Content-Encoding: gzip',
					`Content-Length: ${compressedBody.length}`,
					'',
					'',
				].join('\r\n');

				fakeSocket.push(headers);
				fakeSocket.push(compressedBody);
				fakeSocket.push(null);
			});

			return fakeSocket as any;
		});

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/gzip', query: '' },
			ipVersion: 4,
		});

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.status).to.equal('finished');
		expect(result.statusCode).to.equal(200);
		expect(result.headers['content-encoding']).to.equal('gzip');
		expect(result.rawBody).to.equal(originalText);
	});

	it('should concatenate duplicate headers with comma', async () => {
		mockHttpResponse([
			'HTTP/1.1 200 OK',
			'Access-Control-Expose-Headers: Location',
			'Access-Control-Expose-Headers: X-Version',
			'Set-Cookie: cookie1=value1',
			'Set-Cookie: cookie2=value2',
			'Content-Type: text/plain',
			'',
			'',
		]);

		await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
			type: 'http' as const,
			target: 'google.com',
			inProgressUpdates: false,
			protocol: 'HTTP',
			request: { method: 'GET', path: '/', query: '' },
			ipVersion: 4,
		});

		const result = mockedSocket.emit.firstCall.args[1].result;

		expect(result.headers['access-control-expose-headers']).to.deep.equal([ 'Location', 'X-Version' ]);
		expect(result.rawHeaders).to.include('Access-Control-Expose-Headers: Location');
		expect(result.rawHeaders).to.include('Access-Control-Expose-Headers: X-Version');
		expect(result.headers['set-cookie']).to.deep.equal([ 'cookie1=value1', 'cookie2=value2' ]);
		expect(result.rawHeaders).to.include('Set-Cookie: cookie1=value1');
		expect(result.rawHeaders).to.include('Set-Cookie: cookie2=value2');
	});

	it('should reject private target on validation', async () => {
		try {
			await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
				type: 'http' as const,
				target: '127.0.0.1',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: { method: 'GET', path: '/', query: '' },
				ipVersion: 4,
			});

			expect.fail('Expected validation error');
		} catch (error: unknown) {
			expect(error).to.be.instanceOf(Error);
			expect((error as Error).message).to.equal('Private IP ranges are not allowed.');
		}
	});

	it('should reject private resolver on validation', async () => {
		try {
			await new HttpCommand().run(mockedSocket as any, 'measurement', 'test', {
				type: 'http' as const,
				target: 'example.com',
				resolver: '127.0.0.1',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: { method: 'GET', path: '/', query: '' },
				ipVersion: 4,
			});

			expect.fail('Expected validation error');
		} catch (error: unknown) {
			expect(error).to.be.instanceOf(Error);
			expect((error as Error).message).to.equal('Private IP ranges are not allowed.');
		}
	});
});
