import { PassThrough } from 'node:stream';
import nock from 'nock';
import { type Request, type PlainResponse, HTTPError, CacheError, RequestError, Response } from 'got';
import * as sinon from 'sinon';
import { expect } from 'chai';
import { Socket } from 'socket.io-client';
import {
	HttpCommand,
	httpCmd,
	urlBuilder,
	type Timings, HttpOptions,
} from '../../../src/command/http-command.js';
import { getCmdMock } from '../../utils.js';

type StreamCert = {
	valid_from: number | string;
	valid_to: number | string;
	issuer: {
		[k: string]: string;
		CN: string;
	};
	subject: {
		[k: string]: string;
		CN: string;
	};
	subjectaltname: string; // 'DNS:*.google.com, DNS:google.com'
};

type StreamCipher = {
	name: string;
	version: string;
};

type StreamResponse = {
	timings: Timings;
	statusCode?: number;
	statusMessage?: string;
	httpVersion?: string;
	socket: {
		authorized?: boolean;
		authorizationError?: string;
		cert?: StreamCert;
		getPeerCertificate?: () => StreamCert;
		getCipher?: () => StreamCipher;
	};
	headers?: object;
	rawHeaders?: string[];
};

class Stream extends PassThrough {
	response: StreamResponse | undefined;
	timings: Timings | undefined;
	stream: PassThrough;
	ip: string;
	options: {context: {downloadLimit?: number}};

	constructor (
		response: StreamResponse,
		ip: string,
	) {
		super();
		this.stream = new PassThrough();
		this.response = response;
		this.timings = response?.timings;
		this.ip = ip;
		this.options = { context: { downloadLimit: 10_000 } };
	}
}

describe('http command', () => {
	const sandbox = sinon.createSandbox({ useFakeTimers: { now: 1689320000150 } });
	const mockedSocket = sandbox.createStubInstance(Socket);

	beforeEach(() => {
		sandbox.reset();
	});

	after(() => {
		sandbox.restore();
	});

	describe('url builder', () => {
		describe('prefix', () => {
			it('should set http:// prefix (HTTP)', () => {
				const options = {
					type: 'http',
					target: 'google.com',
					protocol: 'HTTP',
					request: {
						method: 'GET',
						path: '/',
						query: '',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options as HttpOptions);

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

				const url = urlBuilder(options);

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

				const url = urlBuilder(options);

				expect(url).to.equal('https://google.com:443/');
			});
		});

		describe('target', () => {
			it('should enclose an IPv6 addresses in brackets', () => {
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

				const url = urlBuilder(options);

				expect(url).to.equal('http://[2606:4700:4700::1111]:80/');
			});

			it('should not enclose an IPv4 addresses in brackets', () => {
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

				const url = urlBuilder(options);

				expect(url).to.equal('http://1.1.1.1:80/');
			});

			it('should enclose a domain in brackets', () => {
				const options = {
					type: 'http' as const,
					target: 'jsdelivr.com',
					protocol: 'HTTP',
					request: {
						method: 'GET',
						path: '/',
						query: '',
					},
					inProgressUpdates: false,
					ipVersion: 6,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('http://jsdelivr.com:80/');
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

				const url = urlBuilder(options);

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

				const url = urlBuilder(options);

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

				const url = urlBuilder(options);

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

				const url = urlBuilder(options);

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

				const url = urlBuilder(options);

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

				const url = urlBuilder(options);

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

				const url = urlBuilder(options);

				expect(url).to.equal('http://google.com:80/?abc=def');
			});
		});
	});

	describe('with real httpCmd', () => {
		it('should respond with 200', async () => {
			nock('http://google.com').get('/200?abc=def').reply(200, function () {
				const request = this.req as typeof this.req & {response: Response & {socket: { getPeerCertificate }}};
				request.response.httpVersion = '1.1';
				request.response.socket.getPeerCertificate = false;
				return '200 Ok';
			}, { test: 'abc' });

			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: true,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/200',
					query: 'abc=def',
				},
				ipVersion: 4,
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(2);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:progress', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					rawHeaders: 'test: abc',
					rawBody: '200 Ok',
					rawOutput: 'HTTP/1.1 200\ntest: abc\n\n200 Ok',
				},
			}]);

			expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '127.0.0.1',
					headers: { test: 'abc' },
					rawHeaders: 'test: abc',
					rawBody: '200 Ok',
					rawOutput: 'HTTP/1.1 200\ntest: abc\n\n200 Ok',
					truncated: false,
					statusCode: 200,
					statusCodeName: 'OK',
					timings: {
						total: 0,
						download: 0,
						firstByte: 0,
						dns: 0,
						tls: null,
						tcp: 0,
					},
					tls: null,
				},
			}]);
		});

		it('should respond with 200', async () => {
			nock('http://google.com').get('/200?abc=def').reply(200, function () {
				const request = this.req as typeof this.req & {response: Response & {socket: { getPeerCertificate }}};
				request.response.httpVersion = '1.1';
				request.response.socket.getPeerCertificate = false;
				return '200 Ok';
			}, { test: 'abc' });

			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/200',
					query: 'abc=def',
				},
				ipVersion: 4,
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(1);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([
				'probe:measurement:result',
				{
					testId: 'test',
					measurementId: 'measurement',
					result: {
						status: 'finished',
						resolvedAddress: '127.0.0.1',
						headers: { test: 'abc' },
						rawHeaders: 'test: abc',
						rawBody: '200 Ok',
						rawOutput: 'HTTP/1.1 200\ntest: abc\n\n200 Ok',
						truncated: false,
						statusCode: 200,
						statusCodeName: 'OK',
						timings: {
							total: 0,
							download: 0,
							firstByte: 0,
							dns: 0,
							tls: null,
							tcp: 0,
						},
						tls: null,
					},
				},
			]);
		});

		it('should respond with 200 on OPTIONS request and response with body', async () => {
			nock('http://google.com').options('/').reply(200, function () {
				const request = this.req as typeof this.req & {response: Response & {socket: { getPeerCertificate }}};
				request.response.httpVersion = '1.1';
				request.response.socket.getPeerCertificate = false;
				return 'response body';
			});

			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: {
					method: 'OPTIONS',
					path: '/',
					query: '',
				},
				ipVersion: 4,
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(1);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([
				'probe:measurement:result',
				{
					testId: 'test',
					measurementId: 'measurement',
					result: {
						status: 'finished',
						resolvedAddress: '127.0.0.1',
						headers: {},
						rawHeaders: null,
						rawBody: 'response body',
						rawOutput: 'HTTP/1.1 200\n\n\nresponse body',
						truncated: false,
						statusCode: 200,
						statusCodeName: 'OK',
						timings: {
							total: 0,
							download: 0,
							firstByte: 0,
							dns: 0,
							tls: null,
							tcp: 0,
						},
						tls: null,
					},
				},
			]);
		});

		it('should respond with 200 on OPTIONS request and response without body', async () => {
			nock('http://google.com').options('/').reply(200, function () {
				const request = this.req as typeof this.req & {response: Response & {socket: { getPeerCertificate }}};
				request.response.httpVersion = '1.1';
				request.response.socket.getPeerCertificate = false;
			});

			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: {
					method: 'OPTIONS',
					path: '/',
					query: '',
				},
				ipVersion: 4,
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(1);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([
				'probe:measurement:result',
				{
					testId: 'test',
					measurementId: 'measurement',
					result: {
						status: 'finished',
						resolvedAddress: '127.0.0.1',
						headers: {},
						rawHeaders: null,
						rawBody: null,
						rawOutput: 'HTTP/1.1 200\n',
						truncated: false,
						statusCode: 200,
						statusCodeName: 'OK',
						timings: {
							total: 0,
							download: 0,
							firstByte: 0,
							dns: 0,
							tls: null,
							tcp: 0,
						},
						tls: null,
					},
				},
			]);
		});

		it('should respond with 400 with progress messages', async () => {
			nock('http://google.com').get('/400').times(3).reply(400, function () {
				const request = this.req as typeof this.req & {response: Response & {socket: { getPeerCertificate }}};
				request.response.httpVersion = '1.1';
				request.response.socket.getPeerCertificate = false;
				return '400 Bad Request';
			}, { test: 'abc' });

			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: true,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/400',
					query: '',
				},
				ipVersion: 4,
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(2);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:progress', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					rawHeaders: 'test: abc',
					rawBody: '400 Bad Request',
					rawOutput: 'HTTP/1.1 400\ntest: abc\n\n400 Bad Request',
				},
			}]);

			expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '127.0.0.1',
					headers: { test: 'abc' },
					rawHeaders: 'test: abc',
					rawBody: '400 Bad Request',
					rawOutput: 'HTTP/1.1 400\ntest: abc\n\n400 Bad Request',
					truncated: false,
					statusCode: 400,
					statusCodeName: 'Bad Request',
					timings: {
						total: 0,
						download: 0,
						firstByte: 0,
						dns: 0,
						tls: null,
						tcp: 0,
					},
					tls: null,
				},
			}]);
		});

		it('should respond with 400', async () => {
			nock('http://google.com').get('/400').times(3).reply(400, '400 Bad Request', { test: 'abc' });
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/400',
					query: '',
				},
				ipVersion: 4,
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(1);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:result', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '127.0.0.1',
					headers: { test: 'abc' },
					rawHeaders: 'test: abc',
					rawBody: '400 Bad Request',
					rawOutput: 'HTTP/1.1 400\ntest: abc\n\n400 Bad Request',
					truncated: false,
					statusCode: 400,
					statusCodeName: 'Bad Request',
					timings: {
						total: 0,
						download: 0,
						firstByte: 0,
						dns: 0,
						tls: null,
						tcp: 0,
					},
					tls: null,
				},
			}]);
		});

		it('should respond with 400 (missing path slash)', async () => {
			nock('http://google.com').get('/400').times(3).reply(400, function () {
				const request = this.req as typeof this.req & {response: Response & {socket: { getPeerCertificate }}};
				request.response.httpVersion = '1.1';
				request.response.socket.getPeerCertificate = false;
				return '400 Bad Request';
			}, { test: 'abc' });

			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: true,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '400',
					query: '',
				},
				ipVersion: 4,
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(2);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:progress', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					rawHeaders: 'test: abc',
					rawBody: '400 Bad Request',
					rawOutput: 'HTTP/1.1 400\ntest: abc\n\n400 Bad Request',
				},
			}]);

			expect(mockedSocket.emit.lastCall.args).to.deep.equal([ 'probe:measurement:result', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '127.0.0.1',
					headers: { test: 'abc' },
					rawHeaders: 'test: abc',
					rawBody: '400 Bad Request',
					rawOutput: 'HTTP/1.1 400\ntest: abc\n\n400 Bad Request',
					truncated: false,
					statusCode: 400,
					statusCodeName: 'Bad Request',
					timings: {
						total: 0,
						download: 0,
						firstByte: 0,
						dns: 0,
						tls: null,
						tcp: 0,
					},
					tls: null,
				},
			}]);
		});

		it('should ensure keepAlive header is disabled', () => {
			nock('http://google.com').get('/400').times(3).reply(400, '400 Bad Request', { test: 'abc' });
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/400',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const returnedOptions = httpCmd(options).options;

			expect(returnedOptions.agent.http).to.have.property('keepAlive', false);
			expect(returnedOptions.agent.https).to.have.property('keepAlive', false);
		});
	});

	describe('with mocked httpCmd', () => {
		it('should emit progress + result events', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: true,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				statusCode: 200,
				statusMessage: 'OK',
				httpVersion: '1.1',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined as number | undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', response);

			for (const data of [ 'abc', 'def', 'ghi', 'jkl', 'mno' ]) {
				stream.emit('data', Buffer.from(data));
			}

			response.timings['end'] = 1689320000100;
			response.timings.phases['download'] = 75;
			response.timings.phases['total'] = 100;

			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(2);

			expect(mockedSocket.emit.firstCall.args).to.deep.equal([ 'probe:measurement:progress', {
				testId: 'test',
				measurementId: 'measurement',
				result: {
					rawHeaders: 'test: abc',
					rawBody: 'abc',
					rawOutput: 'HTTP/1.1 200\ntest: abc\n\nabc',
				},
			}]);

			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: {
						test: 'abc',
					},
					timings: {
						dns: 5,
						tls: 2,
						tcp: 2,
						download: 75,
						firstByte: 1,
						total: 100,
					},
					rawHeaders: 'test: abc',
					rawBody: 'abcdefghijklmno',
					rawOutput: 'HTTP/1.1 200\ntest: abc\n\nabcdefghijklmno',
					truncated: false,
					statusCode: 200,
					statusCodeName: 'OK',
					tls: null,
				},
				testId: 'test',
			});
		});

		it('should emit only result event', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				statusCode: 200,
				statusMessage: 'OK',
				httpVersion: '1.1',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', response);

			for (const data of [ 'abc', 'def', 'ghi', 'jkl', 'mno' ]) {
				stream.emit('data', Buffer.from(data));
			}

			response.timings['end'] = 1689320000100;
			response.timings.phases['download'] = 75;
			response.timings.phases['total'] = 100;

			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: {
						test: 'abc',
					},
					timings: {
						dns: 5,
						tls: 2,
						tcp: 2,
						download: 75,
						firstByte: 1,
						total: 100,
					},
					rawHeaders: 'test: abc',
					rawBody: 'abcdefghijklmno',
					rawOutput: 'HTTP/1.1 200\ntest: abc\n\nabcdefghijklmno',
					truncated: false,
					statusCode: 200,
					statusCodeName: 'OK',
					tls: null,
				},
				testId: 'test',
			});
		});

		it('should send proper timings if some fields are equal to 0 and some are missing', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				statusCode: 200,
				statusMessage: 'OK',
				httpVersion: '1.1',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', response);

			for (const data of [ 'abc', 'def', 'ghi', 'jkl', 'mno' ]) {
				stream.emit('data', Buffer.from(data));
			}

			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal({
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: { test: 'abc' },
					rawHeaders: 'test: abc',
					rawBody: 'abcdefghijklmno',
					rawOutput: 'HTTP/1.1 200\ntest: abc\n\nabcdefghijklmno',
					truncated: false,
					statusCode: 200,
					statusCodeName: 'OK',
					timings: {
						total: 150,
						download: 100,
						firstByte: 1,
						dns: 5,
						tls: 2,
						tcp: 2,
					},
					tls: null,
				},
			});
		});

		it('should emit headers (rawOutput - HEAD request)', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'HEAD',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				statusCode: 200,
				statusMessage: 'OK',
				httpVersion: '1.1',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', response);

			response.timings['end'] = 1689320000100;
			response.timings.phases['download'] = 75;
			response.timings.phases['total'] = 100;

			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: {
						test: 'abc',
					},
					timings: {
						dns: 5,
						total: 100,
						tls: 2,
						tcp: 2,
						firstByte: 1,
						download: 75,
					},
					rawHeaders: 'test: abc',
					rawBody: null,
					rawOutput: 'HTTP/1.1 200\ntest: abc',
					truncated: false,
					statusCode: 200,
					statusCodeName: 'OK',
					tls: null,
				},
				testId: 'test',
			});
		});

		it('should filter out :status header (HTTP/2 - rawHeader)', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'HEAD',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const cert = {
				valid_from: (new Date(1_657_802_359_042)).toUTCString(),
				valid_to: (new Date(1_657_802_359_042)).toUTCString(),
				issuer: {
					CN: 'abc ltd',
				},
				subject: {
					CN: 'defllc.dom',
				},
				subjectaltname: 'DNS:defllc.com, DNS:*.defllc.com',
				pubkey: Buffer.from([ 4, 55, 35, 80, 122, 235, 134, 144, 100, 122, 188, 126, 87, 129, 189, 158, 239, 164, 55, 229, 237, 101, 45, 193, 159, 174, 200, 243, 96, 116, 247, 73, 155, 181, 143, 196, 95, 138, 27, 5, 187, 163, 255, 222, 149, 197, 87, 17, 19, 56, 181, 188, 24, 162, 56, 253, 160, 12, 39, 5, 148, 116, 177, 251, 229 ]),
				bits: 256,
				serialNumber: '23755E3DEA9FA042868D14AE4304F0B2910BDACF',
				fingerprint256: 'DB:6D:D8:7C:3F:12:31:28:72:C3:B2:B6:53:BE:CB:28:1C:F2:F4:C2:2E:25:6B:95:B2:DC:AF:FE:D1:95:62:F3',
				asn1Curve: 'prime256v1',
				nistCurve: 'P-256',
			};

			const cipher = {
				name: 'ECDHE-RSA-AES128-GCM-SHA256',
				version: 'TLSv1.3',
			};

			const response: StreamResponse = {
				socket: {
					authorized: true,
					getPeerCertificate: () => cert,
					getCipher: () => cipher,
				},
				statusCode: 200,
				statusMessage: 'OK',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				httpVersion: '2',
				headers: { test: 'abc' },
				rawHeaders: [ ':status', '200', 'test', 'abc' ],
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);
			stream.emit('response', response);

			response.timings['end'] = 1689320000100;
			response.timings.phases['download'] = 75;
			response.timings.phases['total'] = 100;

			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: {
						test: 'abc',
					},
					timings: {
						tls: 2,
						tcp: 2,
						total: 100,
						dns: 5,
						firstByte: 1,
						download: 75,
					},
					tls: {
						authorized: true,
						protocol: 'TLSv1.3',
						cipherName: 'ECDHE-RSA-AES128-GCM-SHA256',
						createdAt: (new Date(cert.valid_from)).toISOString(),
						expiresAt: (new Date(cert.valid_from)).toISOString(),
						issuer: {
							...cert.issuer,
						},
						keyType: 'EC',
						keyBits: 256,
						publicKey: '04:37:23:50:7A:EB:86:90:64:7A:BC:7E:57:81:BD:9E:EF:A4:37:E5:ED:65:2D:C1:9F:AE:C8:F3:60:74:F7:49:9B:B5:8F:C4:5F:8A:1B:05:BB:A3:FF:DE:95:C5:57:11:13:38:B5:BC:18:A2:38:FD:A0:0C:27:05:94:74:B1:FB:E5',
						serialNumber: '23:75:5E:3D:EA:9F:A0:42:86:8D:14:AE:43:04:F0:B2:91:0B:DA:CF',
						fingerprint256: 'DB:6D:D8:7C:3F:12:31:28:72:C3:B2:B6:53:BE:CB:28:1C:F2:F4:C2:2E:25:6B:95:B2:DC:AF:FE:D1:95:62:F3',
						subject: {
							...cert.subject,
							alt: cert.subjectaltname,
						},
					},
					rawHeaders: 'test: abc',
					rawBody: null,
					rawOutput: 'HTTP/2 200\ntest: abc',
					truncated: false,
					statusCode: 200,
					statusCodeName: 'OK',
				},
				testId: 'test',
			});
		});

		it('should include pubkey type info', async () => {
			const options = {
				type: 'http' as const,
				target: 'twitter.com',
				protocol: 'HTTPS',
				request: {
					method: 'HEAD',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const cert = {
				valid_from: 'Oct 31 00:00:00 2023 GMT',
				valid_to: 'Oct 29 23:59:59 2024 GMT',
				issuer: {
					C: 'US',
					O: 'DigiCert Inc',
					CN: 'DigiCert Global G2 TLS RSA SHA256 2020 CA1',
				},
				subject: {
					C: 'US',
					ST: 'California',
					L: 'San Francisco',
					O: 'Twitter, Inc.',
					CN: 'twitter.com',
				},
				subjectaltname: 'DNS:twitter.com, DNS:www.twitter.com, DNS:x.com, DNS:www.x.com',
				pubkey: Buffer.from([ 48, 130, 1, 34, 48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0, 3, 130, 1, 15, 0, 48, 130, 1, 10, 2, 130, 1, 1, 0, 209, 177, 80, 209, 35, 204, 120, 111, 199, 128, 231, 134, 188, 102, 237, 61, 3, 127, 111, 41, 149, 152, 198, 155, 243, 189, 89, 85, 199, 188, 160, 170, 155, 1, 12, 226, 49, 147, 164, 116, 17, 92, 90, 76, 196, 253, 179, 57, 102, 14, 199, 62, 224, 231, 176, 1, 104, 183, 49, 255, 114, 202, 205, 88, 34, 223, 21, 40, 160, 89, 154, 100, 239, 232, 165, 77, 240, 126, 39, 2, 2, 78, 186, 168, 89, 224, 159, 150, 71, 159, 191, 112, 217, 255, 241, 174, 187, 192, 100, 220, 14, 109, 159, 168, 224, 114, 191, 219, 232, 78, 116, 159, 181, 212, 140, 228, 182, 45, 235, 23, 251, 140, 244, 191, 233, 68, 140, 100, 229, 13, 127, 89, 174, 28, 238, 214, 161, 122, 210, 20, 58, 190, 190, 105, 190, 141, 89, 183, 1, 64, 44, 3, 253, 212, 8, 11, 49, 176, 186, 3, 85, 32, 83, 166, 49, 79, 216, 99, 243, 104, 204, 102, 18, 24, 145, 113, 240, 157, 190, 144, 225, 42, 236, 137, 97, 254, 58, 253, 70, 7, 62, 6, 52, 137, 107, 253, 73, 139, 51, 39, 68, 182, 201, 22, 80, 64, 231, 133, 132, 197, 248, 122, 124, 118, 117, 119, 232, 237, 33, 184, 35, 28, 97, 132, 43, 253, 226, 9, 10, 25, 49, 234, 78, 100, 210, 13, 101, 211, 231, 153, 55, 135, 27, 194, 191, 4, 31, 61, 64, 36, 76, 210, 98, 28, 4, 31, 2, 3, 1, 0, 1 ]),
				bits: 4096,
				serialNumber: '759280FC2832B46F4D8D256E065EA8ADB4A087D5',
				fingerprint256: 'E1:17:45:D1:32:4A:4B:12:FB:A0:A9:F6:70:8C:69:A6:84:22:1D:48:2A:06:40:5E:D3:51:CD:90:EE:E8:68:39',
				exponent: '0x10001',
				modulus: 'D1B150D123CC786FC780E786BC66ED3D037F6F299598C69BF3BD5955C7BCA0AA9B010CE23193A474115C5A4CC4FDB339660EC73EE0E7B00168B731FF72CACD5822DF1528A0599A64EFE8A54DF07E2702024EBAA859E09F96479FBF70D9FFF1AEBBC064DC0E6D9FA8E072BFDBE84E749FB5D48CE4B62DEB17FB8CF4BFE9448C64E50D7F59AE1CEED6A17AD2143ABEBE69BE8D59B701402C03FDD4080B31B0BA03552053A6314FD863F368CC6612189171F09DBE90E12AEC8961FE3AFD46073E0634896BFD498B332744B6C9165040E78584C5F87A7C767577E8ED21B8231C61842BFDE2090A1931EA4E64D20D65D3E79937871BC2BF041F3D40244CD2621C041F',
			};

			const cipher = {
				name: 'ECDHE-RSA-AES128-GCM-SHA256',
				version: 'TLSv1.3',
			};

			const response: StreamResponse = {
				socket: {
					authorized: true,
					getPeerCertificate: () => cert,
					getCipher: () => cipher,
				},
				statusCode: 200,
				statusMessage: 'OK',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				httpVersion: '1.1',
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);
			stream.emit('response', response);

			response.timings['end'] = 1689320000100;
			response.timings.phases['download'] = 75;
			response.timings.phases['total'] = 100;

			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: {
						test: 'abc',
					},
					timings: {
						tls: 2,
						tcp: 2,
						total: 100,
						dns: 5,
						firstByte: 1,
						download: 75,
					},
					tls: {
						authorized: true,
						protocol: 'TLSv1.3',
						cipherName: 'ECDHE-RSA-AES128-GCM-SHA256',
						createdAt: '2023-10-31T00:00:00.000Z',
						expiresAt: '2024-10-29T23:59:59.000Z',
						issuer: {
							...cert.issuer,
						},
						keyType: 'RSA',
						keyBits: 4096,
						publicKey: '30:82:01:22:30:0D:06:09:2A:86:48:86:F7:0D:01:01:01:05:00:03:82:01:0F:00:30:82:01:0A:02:82:01:01:00:D1:B1:50:D1:23:CC:78:6F:C7:80:E7:86:BC:66:ED:3D:03:7F:6F:29:95:98:C6:9B:F3:BD:59:55:C7:BC:A0:AA:9B:01:0C:E2:31:93:A4:74:11:5C:5A:4C:C4:FD:B3:39:66:0E:C7:3E:E0:E7:B0:01:68:B7:31:FF:72:CA:CD:58:22:DF:15:28:A0:59:9A:64:EF:E8:A5:4D:F0:7E:27:02:02:4E:BA:A8:59:E0:9F:96:47:9F:BF:70:D9:FF:F1:AE:BB:C0:64:DC:0E:6D:9F:A8:E0:72:BF:DB:E8:4E:74:9F:B5:D4:8C:E4:B6:2D:EB:17:FB:8C:F4:BF:E9:44:8C:64:E5:0D:7F:59:AE:1C:EE:D6:A1:7A:D2:14:3A:BE:BE:69:BE:8D:59:B7:01:40:2C:03:FD:D4:08:0B:31:B0:BA:03:55:20:53:A6:31:4F:D8:63:F3:68:CC:66:12:18:91:71:F0:9D:BE:90:E1:2A:EC:89:61:FE:3A:FD:46:07:3E:06:34:89:6B:FD:49:8B:33:27:44:B6:C9:16:50:40:E7:85:84:C5:F8:7A:7C:76:75:77:E8:ED:21:B8:23:1C:61:84:2B:FD:E2:09:0A:19:31:EA:4E:64:D2:0D:65:D3:E7:99:37:87:1B:C2:BF:04:1F:3D:40:24:4C:D2:62:1C:04:1F:02:03:01:00:01',
						serialNumber: '75:92:80:FC:28:32:B4:6F:4D:8D:25:6E:06:5E:A8:AD:B4:A0:87:D5',
						fingerprint256: 'E1:17:45:D1:32:4A:4B:12:FB:A0:A9:F6:70:8C:69:A6:84:22:1D:48:2A:06:40:5E:D3:51:CD:90:EE:E8:68:39',
						subject: {
							...cert.subject,
							alt: cert.subjectaltname,
						},
					},
					rawHeaders: 'test: abc',
					rawBody: null,
					rawOutput: 'HTTP/1.1 200\ntest: abc',
					truncated: false,
					statusCode: 200,
					statusCodeName: 'OK',
				},
				testId: 'test',
			});
		});

		it('should send "finished" status if it is HTTPError', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				statusCode: 404,
				statusMessage: 'Not Found',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				httpVersion: '1.1',
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const stream = new Stream(response, '');

			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', response);

			response.timings['end'] = 1689320000100;
			response.timings.phases['download'] = 75;
			response.timings.phases['total'] = 100;

			stream.emit('error', new HTTPError({ statusCode: 404, statusMessage: 'Not Found' } as unknown as PlainResponse));

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					headers: {
						test: 'abc',
					},
					rawBody: null,
					rawHeaders: 'test: abc',
					rawOutput: 'HTTP/1.1 404\ntest: abc\n\nResponse code 404 (Not Found) - ERR_NON_2XX_3XX_RESPONSE',
					truncated: false,
					resolvedAddress: null,
					status: 'finished',
					statusCode: 404,
					statusCodeName: 'Not Found',
					timings: {
						dns: 5,
						download: 75,
						firstByte: 1,
						tcp: 2,
						tls: 2,
						total: 100,
					},
					tls: null,
				},
				testId: 'test',
			});
		});

		it('should work correctly if error doesn\'t have timings field', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const response = {
				socket: {},
			};

			const stream = new Stream(response as StreamResponse, '');

			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('error', new RequestError('Invalid URL', { code: 'ERR_INVALID_URL' }, {} as unknown as Request));

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					status: 'failed',
					resolvedAddress: null,
					headers: {},
					rawHeaders: null,
					rawBody: null,
					timings: {
						dns: null,
						firstByte: null,
						tcp: null,
						tls: null,
						download: null,
						total: null,
					},
					tls: null,
					rawOutput: 'Invalid URL - ERR_INVALID_URL',
					truncated: false,
					statusCode: null,
					statusCodeName: null,
				},
				testId: 'test',
			});
		});

		it('should send "failed" status in all other cases of errors', async () => {
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

			const response: StreamResponse = {
				socket: {},
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					phases: {},
				},
			};

			const stream = new Stream(response, '');

			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('error', new CacheError(new Error('cache error'), {} as unknown as Request));

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					status: 'failed',
					resolvedAddress: null,
					headers: {},
					rawHeaders: null,
					rawBody: null,
					timings: {
						dns: null,
						firstByte: null,
						tcp: null,
						tls: null,
						download: null,
						total: null,
					},
					tls: null,
					rawOutput: 'cache error - ERR_CACHE_ACCESS',
					truncated: false,
					statusCode: null,
					statusCodeName: null,
				},
				testId: 'test',
			});
		});

		it('should send "failed" status in all other cases of errors while `inProgressUpdates: true`', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					phases: {},
				},
			};

			const stream = new Stream(response, '');

			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('error', new CacheError(new Error('cache error'), {} as unknown as Request));

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				measurementId: 'measurement',
				result: {
					status: 'failed',
					resolvedAddress: null,
					headers: {},
					rawHeaders: null,
					rawBody: null,
					timings: {
						dns: null,
						firstByte: null,
						tcp: null,
						tls: null,
						download: null,
						total: null,
					},
					tls: null,
					rawOutput: 'cache error - ERR_CACHE_ACCESS',
					truncated: false,
					statusCode: null,
					statusCodeName: null,
				},
				testId: 'test',
			});
		});

		it('should send only first 10 KB of data if response body is too big', async () => {
			const options = {
				type: 'http' as const,
				target: 'cdn.jsdelivr.net',
				inProgressUpdates: false,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/npm/jquery',
					query: '',
				},
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				statusCode: 200,
				statusMessage: 'OK',
				httpVersion: '1.1',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const httpResponse = getCmdMock('http-big-response-size');
			const data = httpResponse.split('\n');

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', response);

			for (const chunk of data) {
				stream.emit('data', Buffer.from(chunk));
			}

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);

			expect((mockedSocket.emit.lastCall.args[0] as any)).to.equal('probe:measurement:result');
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawBody.length).to.equal(10000);
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawOutput.substring(0, 24)).to.equal('HTTP/1.1 200\ntest: abc\n\n');
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawOutput.length).to.equal(10024);

			delete (mockedSocket.emit.lastCall.args[1] as any).result.rawBody;
			delete (mockedSocket.emit.lastCall.args[1] as any).result.rawOutput;

			expect((mockedSocket.emit.lastCall.args[1] as any)).to.deep.equal({
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: { test: 'abc' },
					rawHeaders: 'test: abc',
					truncated: true,
					statusCode: 200,
					statusCodeName: 'OK',
					timings: {
						total: 150,
						download: 100,
						firstByte: 1,
						dns: 5,
						tls: 2,
						tcp: 2,
					},
					tls: null,
				},
			});
		});

		it('should send only first 10 KB of data if response body is too big while `inProgressUpdates: true`', async () => {
			const options = {
				type: 'http' as const,
				target: 'cdn.jsdelivr.net',
				inProgressUpdates: true,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/npm/jquery',
					query: '',
				},
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				statusCode: 200,
				statusMessage: 'OK',
				httpVersion: '1.1',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const httpResponse = getCmdMock('http-big-response-size');
			const data = httpResponse.split('\n');

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', response);

			for (const chunk of data) {
				stream.emit('data', Buffer.from(chunk));
			}

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(2);

			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:progress');
			expect(mockedSocket.emit.firstCall.args[1]).to.have.nested.property('result.rawBody.length', data[0]!.length);
			expect((mockedSocket.emit.firstCall.args[1] as any).result.rawOutput.substring(0, 24)).to.equal('HTTP/1.1 200\ntest: abc\n\n');
			expect(mockedSocket.emit.firstCall.args[1]).to.have.nested.property('result.rawOutput.length', 'HTTP/1.1 200\ntest: abc\n\n'.length + data[0]!.length);

			delete (mockedSocket.emit.firstCall.args[1] as any).result.rawBody;
			delete (mockedSocket.emit.firstCall.args[1] as any).result.rawOutput;

			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal({
				testId: 'test',
				measurementId: 'measurement',
				result: { rawHeaders: 'test: abc' },
			});

			expect((mockedSocket.emit.lastCall.args[0])).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.rawBody.length', 10000);
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawOutput.substring(0, 24)).to.equal('HTTP/1.1 200\ntest: abc\n\n');
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.rawOutput.length', 10024);

			delete (mockedSocket.emit.lastCall.args[1] as any).result.rawBody;
			delete (mockedSocket.emit.lastCall.args[1] as any).result.rawOutput;

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'finished',
					truncated: true,
					resolvedAddress: '1.1.1.1',
					headers: { test: 'abc' },
					rawHeaders: 'test: abc',
					statusCode: 200,
					statusCodeName: 'OK',
					timings: { total: 150, download: 100, firstByte: 1, dns: 5, tls: 2, tcp: 2 },
					tls: null,
				},
			});
		});

		it('should send only first 10 KB and finish if the first progress message data is too big', async () => {
			const options = {
				type: 'http' as const,
				target: 'cdn.jsdelivr.net',
				inProgressUpdates: true,
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/npm/jquery',
					query: '',
				},
				ipVersion: 4,
			};

			const response: StreamResponse = {
				socket: {},
				statusCode: 200,
				statusMessage: 'OK',
				httpVersion: '1.1',
				timings: {
					start: 1689320000000,
					response: 1689320000050,
					end: undefined,
					phases: {
						tls: 2,
						tcp: 2,
						dns: 5,
						download: undefined,
						total: undefined,
						firstByte: 1,
					},
				},
				headers: { test: 'abc' },
				rawHeaders: [ 'test', 'abc' ],
			};

			const httpResponse = getCmdMock('http-big-response-size');

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', response);

			for (let i = 0; i < 3; i++) {
				stream.emit('data', Buffer.from(httpResponse));
			}

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(2);

			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:progress');
			expect((mockedSocket.emit.firstCall.args[1] as any).result.rawBody.length).to.equal(10000);
			expect((mockedSocket.emit.firstCall.args[1] as any).result.rawOutput.substring(0, 24)).to.equal('HTTP/1.1 200\ntest: abc\n\n');
			expect((mockedSocket.emit.firstCall.args[1] as any).result.rawOutput.length).to.equal(10024);

			delete (mockedSocket.emit.firstCall.args[1] as any).result.rawBody;
			delete (mockedSocket.emit.firstCall.args[1] as any).result.rawOutput;

			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal({
				testId: 'test',
				measurementId: 'measurement',
				result: { rawHeaders: 'test: abc' },
			});

			expect((mockedSocket.emit.lastCall.args[0] as any)).to.equal('probe:measurement:result');
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawHeaders).to.equal('test: abc');
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawBody.length).to.equal(10000);
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawOutput.substring(0, 24)).to.equal('HTTP/1.1 200\ntest: abc\n\n');
			expect((mockedSocket.emit.lastCall.args[1] as any).result.rawOutput.length).to.equal(10024);

			delete (mockedSocket.emit.lastCall.args[1] as any).result.rawBody;
			delete (mockedSocket.emit.lastCall.args[1] as any).result.rawOutput;

			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal({
				testId: 'test',
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: { test: 'abc' },
					truncated: true,
					rawHeaders: 'test: abc',
					statusCode: 200,
					statusCodeName: 'OK',
					timings: { total: 150, download: 100, firstByte: 1, dns: 5, tls: 2, tcp: 2 },
					tls: null,
				},
			});
		});
	});
});
