import {PassThrough} from 'node:stream';
import nock from 'nock';
import {type Request, type PlainResponse, HTTPError, CacheError} from 'got';
import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {
	HttpCommand,
	httpCmd,
	urlBuilder,
	type Timings,
} from '../../../src/command/http-command.js';

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

type StreamResponse = {
	timings: Timings;
	socket: {
		authorized?: boolean;
		authorizationError?: string;
		cert?: StreamCert;
		getPeerCertificate?: () => StreamCert;
	};
};

class Stream {
	response: StreamResponse | undefined;
	timings: Timings | undefined;
	stream: PassThrough;
	ip: string;

	constructor(
		response: StreamResponse,
		ip: string,
	) {
		this.stream = new PassThrough();
		this.response = response;
		this.timings = response?.timings;
		this.ip = ip;
	}

	on(key: string, fn: (..._args: any[]) => void) {
		this.stream.on(key, fn);
	}

	emit(key: string, data?: any) {
		this.stream.emit(key, data);
	}
}

describe('http command', () => {
	const sandbox = sinon.createSandbox();
	const mockedSocket = sandbox.createStubInstance(Socket);

	beforeEach(() => {
		sandbox.reset();
	});

	describe('url builder', () => {
		describe('prefix', () => {
			it('should set http:// prefix (HTTP)', () => {
				const options = {
					type: 'http',
					target: 'google.com',
					protocol: 'http',
					request: {
						method: 'get',
						path: '/',
						query: '',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('http://google.com:80/');
			});

			it('should set https:// prefix (HTTPS)', () => {
				const options = {
					type: 'http' as const,
					target: 'google.com',
					protocol: 'https',
					request: {
						method: 'get',
						path: '/',
						query: '',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('https://google.com:443/');
			});

			it('should set https:// prefix (HTTP2)', () => {
				const options = {
					type: 'http' as const,
					target: 'google.com',
					protocol: 'http2',
					request: {
						method: 'get',
						path: '/',
						query: '',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('https://google.com:443/');
			});
		});

		describe('port', () => {
			it('should set custom port', () => {
				const options = {
					type: 'http' as const,
					target: 'google.com',
					protocol: 'http',
					port: 1212,
					request: {
						method: 'get',
						path: '/',
						query: '',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('http://google.com:1212/');
			});

			it('should set default HTTP port', () => {
				const options = {
					type: 'http' as const,
					target: 'google.com',
					protocol: 'http',
					request: {
						method: 'get',
						path: '/',
						query: '',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('http://google.com:80/');
			});
			it('should set default HTTPS port', () => {
				const options = {
					type: 'http' as const,
					target: 'google.com',
					protocol: 'https',
					request: {
						method: 'get',
						path: '/',
						query: '',
					},
					inProgressUpdates: false,
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
					protocol: 'http',
					request: {
						method: 'get',
						path: 'abc',
						query: '',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('http://google.com:80/abc');
			});

			it('should append pathname at the end of url (prevent double /)', () => {
				const options = {
					type: 'http' as const,
					target: 'google.com',
					protocol: 'http',
					request: {
						method: 'get',
						path: '/abc',
						query: '',
					},
					inProgressUpdates: false,
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
					protocol: 'http',
					request: {
						method: 'get',
						path: '/',
						query: 'abc=def',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('http://google.com:80/?abc=def');
			});

			it('should append query at the end of url (prevent double ?)', () => {
				const options = {
					type: 'http' as const,
					target: 'google.com',
					protocol: 'http',
					request: {
						method: 'get',
						path: '/',
						query: '?abc=def',
					},
					inProgressUpdates: false,
				};

				const url = urlBuilder(options);

				expect(url).to.equal('http://google.com:80/?abc=def');
			});
		});
	});

	describe('with httCmd', () => {
		it('should respond with 200', async () => {
			nock('http://google.com').get('/200?abc=def').reply(200, '200 Ok', {test: 'abc'});
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: true,
				protocol: 'http',
				request: {
					method: 'get',
					path: '/200',
					query: 'abc=def',
				},
			};

			const expectedResult = {
				measurementId: 'measurement',
				result: {
					headers: {
						test: 'abc',
					},
					rawHeaders: 'test: abc',
					rawBody: '200 Ok',
					rawOutput: '200 Ok',
					statusCode: 200,
					statusCodeName: 'OK',
				},
				testId: 'test',
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(2);
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:progress');
			expect(mockedSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:progress', {
				testId: 'test',
				measurementId: 'measurement',
				result: {rawOutput: '200 Ok'},
			}]);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.rawBody', expectedResult.result.rawBody);
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.rawHeaders', expectedResult.result.rawHeaders);
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.statusCode', expectedResult.result.statusCode);
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.statusCodeName', expectedResult.result.statusCodeName);
		});

		it('should respond with 200 without progress messages', async () => {
			nock('http://google.com').get('/200?abc=def').reply(200, '200 Ok', {test: 'abc'});
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'http',
				request: {
					method: 'get',
					path: '/200',
					query: 'abc=def',
				},
			};

			const expectedResult = {
				measurementId: 'measurement',
				result: {
					headers: {
						test: 'abc',
					},
					rawHeaders: 'test: abc',
					rawBody: '200 Ok',
					rawOutput: '200 Ok',
					statusCode: 200,
					statusCodeName: 'OK',
				},
				testId: 'test',
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.have.nested.property('result.rawBody', expectedResult.result.rawBody);
			expect(mockedSocket.emit.firstCall.args[1]).to.have.nested.property('result.rawHeaders', expectedResult.result.rawHeaders);
			expect(mockedSocket.emit.firstCall.args[1]).to.have.nested.property('result.statusCode', expectedResult.result.statusCode);
			expect(mockedSocket.emit.firstCall.args[1]).to.have.nested.property('result.statusCodeName', expectedResult.result.statusCodeName);
		});

		it('should respond with 400', async () => {
			nock('http://google.com').get('/400').times(3).reply(400, '400 Bad Request', {test: 'abc'});
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: true,
				protocol: 'http',
				request: {
					method: 'get',
					path: '/400',
					query: '',
				},
			};

			const expectedResult = {
				measurementId: 'measurement',
				result: {
					headers: {
						test: 'abc',
					},
					rawHeaders: 'test: abc',
					rawBody: '400 Bad Request',
					rawOutput: '400 Bad Request',
					statusCode: 400,
				},
				testId: 'test',
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(2);
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:progress');
			expect(mockedSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:progress', {
				testId: 'test',
				measurementId: 'measurement',
				result: {rawOutput: '400 Bad Request'},
			}]);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.rawBody', expectedResult.result.rawBody);
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.rawHeaders', expectedResult.result.rawHeaders);
		});

		it('should respond with 400 without progress messages', async () => {
			nock('http://google.com').get('/400').times(3).reply(400, '400 Bad Request', {test: 'abc'});
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'http',
				request: {
					method: 'get',
					path: '/400',
					query: '',
				},
			};

			const expectedResult = {
				measurementId: 'measurement',
				result: {
					headers: {
						test: 'abc',
					},
					rawHeaders: 'test: abc',
					rawBody: '400 Bad Request',
					rawOutput: '400 Bad Request',
					statusCode: 400,
				},
				testId: 'test',
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.have.nested.property('result.rawBody', expectedResult.result.rawBody);
			expect(mockedSocket.emit.firstCall.args[1]).to.have.nested.property('result.rawHeaders', expectedResult.result.rawHeaders);
		});

		it('should respond with 400 (missing path slash)', async () => {
			nock('http://google.com').get('/400').times(3).reply(400, '400 Bad Request', {test: 'abc'});
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: true,
				protocol: 'http',
				request: {
					method: 'get',
					path: '400',
					query: '',
				},
			};

			const expectedResult = {
				measurementId: 'measurement',
				result: {
					headers: {
						test: 'abc',
					},
					rawHeaders: 'test: abc',
					rawBody: '400 Bad Request',
					rawOutput: '400 Bad Request',
					statusCode: 400,
				},
				testId: 'test',
			};

			const http = new HttpCommand(httpCmd);
			await http.run(mockedSocket as any, 'measurement', 'test', options);

			expect(mockedSocket.emit.callCount).to.equal(2);
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:progress');
			expect(mockedSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:progress', {
				testId: 'test',
				measurementId: 'measurement',
				result: {rawOutput: '400 Bad Request'},
			}]);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.rawBody', expectedResult.result.rawBody);
			expect(mockedSocket.emit.lastCall.args[1]).to.have.nested.property('result.rawHeaders', expectedResult.result.rawHeaders);
		});

		it('should ensure keepAlive header is disabled', () => {
			nock('http://google.com').get('/400').times(3).reply(400, '400 Bad Request', {test: 'abc'});
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'http',
				request: {
					method: 'get',
					path: '/400',
					query: '',
				},
				inProgressUpdates: false,
			};

			const returnedOptions = httpCmd(options).options;

			expect(returnedOptions.agent.http).to.have.property('keepAlive', false);
			expect(returnedOptions.agent.https).to.have.property('keepAlive', false);
		});
	});

	describe('manual', () => {
		it('should emit progress + result events', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: true,
				protocol: 'http',
				request: {
					method: 'get',
					path: '/',
					query: '',
				},
			};

			const events = {
				response: {
					socket: {},
					statusCode: 200,
					statusMessage: 'OK',
					httpVersion: '1.1',
					timings: {
						start: 0,
						phases: {
							tls: 2,
							tcp: 2,
							dns: 5,
							download: 10,
							total: 11,
							firstByte: 1,
						},
					},
					headers: {test: 'abc'},
					rawHeaders: ['test', 'abc'],
				},
				data: ['abc', 'def', 'ghi', 'jkl', 'mno'],
			};

			const response = {
				...events.response,
			};

			const expectedResult = {
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
						download: 10,
						firstByte: 1,
						total: 11,
					},
					rawHeaders: 'test: abc',
					rawBody: 'abcdefghijklmno',
					rawOutput: 'abcdefghijklmno',
					statusCode: 200,
					statusCodeName: 'OK',
					tls: null,
				},
				testId: 'test',
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', events.response);

			for (const data of events.data) {
				stream.emit('data', Buffer.from(data));
			}

			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(2);
			expect(mockedSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:progress',	{
				testId: 'test',
				measurementId: 'measurement',
				result: {rawOutput: 'abc'},
			}]);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should emit only result event', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				inProgressUpdates: false,
				protocol: 'http',
				request: {
					method: 'get',
					path: '/',
					query: '',
				},
			};

			const events = {
				response: {
					socket: {},
					statusCode: 200,
					statusMessage: 'OK',
					httpVersion: '1.1',
					timings: {
						start: 0,
						phases: {
							tls: 2,
							tcp: 2,
							dns: 5,
							download: 10,
							total: 11,
							firstByte: 1,
						},
					},
					headers: {test: 'abc'},
					rawHeaders: ['test', 'abc'],
				},
				data: ['abc', 'def', 'ghi', 'jkl', 'mno'],
			};

			const response = {
				...events.response,
			};

			const expectedResult = {
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
						download: 10,
						firstByte: 1,
						total: 11,
					},
					rawHeaders: 'test: abc',
					rawBody: 'abcdefghijklmno',
					rawOutput: 'abcdefghijklmno',
					statusCode: 200,
					statusCodeName: 'OK',
					tls: null,
				},
				testId: 'test',
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', events.response);

			for (const data of events.data) {
				stream.emit('data', Buffer.from(data));
			}

			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should emit headers (rawOutput - HEAD request)', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'http',
				request: {
					method: 'head',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
			};

			const events = {
				response: {
					socket: {},
					statusCode: 200,
					statusMessage: 'OK',
					timings: {
						start: 0,
						phases: {
							download: 10,
							total: 11,
							dns: 5,
							tls: 5,
							tcp: 2,
							firstByte: 1,
						},
					},
					httpVersion: '1.1',
					headers: {test: 'abc'},
					rawHeaders: ['test', 'abc'],
				},
			};

			const response = {
				...events.response,
			};

			const expectedResult = {
				measurementId: 'measurement',
				result: {
					status: 'finished',
					resolvedAddress: '1.1.1.1',
					headers: {
						test: 'abc',
					},
					timings: {
						dns: 5,
						total: 11,
						tls: 5,
						tcp: 2,
						firstByte: 1,
						download: 10,
					},
					rawHeaders: 'test: abc',
					rawBody: null,
					rawOutput: 'HTTP/1.1 200\ntest: abc',
					statusCode: 200,
					statusCodeName: 'OK',
					tls: null,
				},
				testId: 'test',
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', events.response);
			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should filter out :status header (HTTP/2 - rawHeader)', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'http',
				request: {
					method: 'head',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
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
			};

			const events = {
				response: {
					socket: {
						authorized: true,
						getPeerCertificate: () => cert,
					},
					statusCode: 200,
					statusMessage: 'OK',
					timings: {
						start: 0,
						phases: {
							download: 10,
							total: 11,
							tls: 2,
							tcp: 2,
							dns: 5,
							firstByte: 1,
						},
					},
					httpVersion: '2',
					headers: {test: 'abc'},
					rawHeaders: [':status', 200, 'test', 'abc'],
				},
			};

			const response = {
				...events.response,
			};

			const expectedResult = {
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
						total: 11,
						dns: 5,
						firstByte: 1,
						download: 10,
					},
					tls: {
						authorized: true,
						createdAt: (new Date(cert.valid_from)).toISOString(),
						expiresAt: (new Date(cert.valid_from)).toISOString(),
						issuer: {
							...cert.issuer,
						},
						subject: {
							...cert.subject,
							alt: cert.subjectaltname,
						},
					},
					rawHeaders: ':status: 200\ntest: abc',
					rawBody: null,
					rawOutput: 'HTTP/2 200\ntest: abc',
					statusCode: 200,
					statusCodeName: 'OK',
				},
				testId: 'test',
			};

			const stream = new Stream(response, '1.1.1.1');
			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', events.response);
			stream.emit('end');

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should send "finished" status if it is HTTPError', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'http',
				request: {
					method: 'get',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
			};

			const events = {
				response: {
					socket: {},
					statusCode: 404,
					statusMessage: 'Not Found',
					timings: {
						start: 0,
						phases: {
							download: 10,
							total: 11,
							dns: 5,
							tls: 5,
							tcp: 2,
							firstByte: 1,
						},
					},
					httpVersion: '1.1',
					headers: {test: 'abc'},
					rawHeaders: ['test', 'abc'],
				},
				error: new HTTPError({statusCode: 404, statusMessage: 'Not Found'} as unknown as PlainResponse),
			};

			const response = {
				...events.response,
			};

			const expectedResult = {
				measurementId: 'measurement',
				result: {
					headers: {
						test: 'abc',
					},
					rawBody: null,
					rawHeaders: 'test: abc',
					rawOutput: 'Response code 404 (Not Found) - ERR_NON_2XX_3XX_RESPONSE',
					resolvedAddress: null,
					status: 'finished',
					statusCode: 404,
					statusCodeName: 'Not Found',
					timings: {
						dns: 5,
						download: 10,
						firstByte: 1,
						tcp: 2,
						tls: 5,
						total: 11,
					},
					tls: null,
				},
				testId: 'test',
			};

			const stream = new Stream(response, '');

			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('response', events.response);
			stream.emit('error', events.error);

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should send "failed" status in all other cases of errors', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'http',
				request: {
					method: 'get',
					path: '/',
					query: '',
				},
				inProgressUpdates: true,
			};

			const events = {
				response: {
					socket: {},
					timings: {
						phases: {
							download: 10,
							total: 11,
						},
					},
				},
				error: new CacheError(new Error('cache error'), {} as unknown as Request),
			};

			const response = {
				...events.response,
			};

			const expectedResult = {
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
						download: 10,
						total: 11,
					},
					tls: null,
					rawOutput: 'cache error - ERR_CACHE_ACCESS',
					statusCode: null,
					statusCodeName: null,
				},
				testId: 'test',
			};

			const stream = new Stream(response, '');

			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('error', events.error);

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
		});

		it('should send "failed" status in all other cases of errors while `inProgressUpdates: false`', async () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'http',
				request: {
					method: 'get',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
			};

			const events = {
				response: {
					socket: {},
					timings: {
						phases: {
							download: 10,
							total: 11,
						},
					},
				},
				error: new CacheError(new Error('cache error'), {} as unknown as Request),
			};

			const response = {
				...events.response,
			};

			const expectedResult = {
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
						download: 10,
						total: 11,
					},
					tls: null,
					rawOutput: 'cache error - ERR_CACHE_ACCESS',
					statusCode: null,
					statusCodeName: null,
				},
				testId: 'test',
			};

			const stream = new Stream(response, '');

			const mockHttpCmd = (): Request => stream as never;

			const http = new HttpCommand(mockHttpCmd);
			const cmd = http.run(mockedSocket as any, 'measurement', 'test', options);

			stream.emit('error', events.error);

			await cmd;

			expect(mockedSocket.emit.callCount).to.equal(1);
			expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
			expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
		});
	});
});
