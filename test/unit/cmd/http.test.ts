import {PassThrough} from 'node:stream';
import type {Request} from 'got';
import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {HttpCommand} from '../../../src/command/http-command.js';

type StreamCert = {
	valid_from: number;
	valid_to: number;
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
	timings: {
		[k: string]: number | Record<string, number>;
		phases?: Record<string, number>;
	};
	socket: {
		authorized?: boolean;
		authorizationError?: string;
		cert?: StreamCert;
		getPeerCertificate?: () => StreamCert;
	};
};

class HttpError extends Error {
	code: string;

	constructor(message: string, code: string) {
		super(message);
		this.code = code;
	}
}

class Stream {
	response: StreamResponse | undefined;
	stream: PassThrough;

	constructor(
		response: StreamResponse,
	) {
		this.stream = new PassThrough();
		this.response = response;
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

	it('should emit progress + result events', async () => {
		const options = {
			type: 'http',
			target: 'google.com',
			query: {
				method: 'get',
				protocol: 'http',
				path: '/',
			},
		};

		const events = {
			response: {
				socket: {},
				statusCode: 200,
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
			data: ['abc', 'def', 'ghi'],
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
				timings: {
					dns: 5,
					tls: 2,
					tcp: 2,
					download: 10,
					firstByte: 1,
					total: 11,
				},
				rawHeaders: 'test: abc',
				rawBody: 'abcdefghi',
				rawOutput: 'abcdefghi',
				statusCode: 200,
				tls: {},
			},
			testId: 'test',
		};

		const stream = new Stream(response);
		const httpCmd = (): Request => stream as never;

		const http = new HttpCommand(httpCmd);
		await http.run(mockedSocket as any, 'measurement', 'test', options);

		stream.emit('response', events.response);

		for (const data of events.data) {
			stream.emit('data', Buffer.from(data));
		}

		stream.emit('end');

		expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:progress');
		expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
		expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
		expect(mockedSocket.emit.callCount).to.equal(4);
	});

	it('should emit headers (rawOutput - HEAD request)', async () => {
		const options = {
			type: 'http',
			target: 'google.com',
			query: {
				method: 'head',
				protocol: 'http',
				path: '/',
			},
		};

		const events = {
			response: {
				socket: {},
				statusCode: 200,
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
				rawBody: '',
				rawOutput: 'HTTP/1.1 200\ntest: abc',
				statusCode: 200,
				tls: {},
			},
			testId: 'test',
		};

		const stream = new Stream(response);
		const httpCmd = (): Request => stream as never;

		const http = new HttpCommand(httpCmd);
		await http.run(mockedSocket as any, 'measurement', 'test', options);

		stream.emit('response', events.response);
		stream.emit('end');

		expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
		expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
	});

	it('should filter out :status header (HTTP/2 - rawHeader)', async () => {
		const options = {
			type: 'http',
			target: 'google.com',
			query: {
				method: 'head',
				protocol: 'http',
				path: '/',
			},
		};

		/* eslint-disable @typescript-eslint/naming-convention */
		const cert = {
			valid_from: 100,
			valid_to: 200,
			issuer: {
				CN: 'abc ltd',
			},
			subject: {
				CN: 'defllc.dom',
			},
			subjectaltname: 'DNS:defllc.com, DNS:*.defllc.com',
		};
		/* eslint-enable @typescript-eslint/naming-convention */

		const events = {
			response: {
				socket: {
					authorized: true,
					getPeerCertificate: () => cert,
				},
				statusCode: 200,
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
					createdAt: 100,
					expireAt: 200,
					issuer: {
						...cert.issuer,
					},
					subject: {
						...cert.subject,
						alt: cert.subjectaltname,
					},
				},
				rawHeaders: ':status: 200\ntest: abc',
				rawBody: '',
				rawOutput: 'HTTP/2 200\ntest: abc',
				statusCode: 200,
			},
			testId: 'test',
		};

		const stream = new Stream(response);
		const httpCmd = (): Request => stream as never;

		const http = new HttpCommand(httpCmd);
		await http.run(mockedSocket as any, 'measurement', 'test', options);

		stream.emit('response', events.response);
		stream.emit('end');

		expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
		expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
	});

	it('should emit error', async () => {
		const options = {
			type: 'http',
			target: 'google.com',
			query: {
				method: 'get',
				protocol: 'http',
				path: '/',
			},
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
			error: new HttpError('ENODATA google.com', 'abc'),
		};

		const response = {
			...events.response,
		};

		const expectedResult = {
			measurementId: 'measurement',
			result: {
				headers: {},
				rawHeaders: '',
				rawBody: '',
				timings: {
					download: 10,
					total: 11,
				},
				tls: {},
				rawOutput: 'ENODATA google.com - abc',
				statusCode: 0,
			},
			testId: 'test',
		};

		const stream = new Stream(response);

		const httpCmd = (): Request => stream as never;

		const http = new HttpCommand(httpCmd);
		await http.run(mockedSocket as any, 'measurement', 'test', options);

		stream.emit('error', events.error);

		expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
		expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
	});
});
