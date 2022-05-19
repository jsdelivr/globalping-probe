import {PassThrough} from 'node:stream';
import type {Request} from 'got';
import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {HttpCommand, HttpOptions} from '../../../src/command/http-command.js';

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
				statusCode: 200,
				headers: {test: 'abc'},
				rawHeaders: ['test', 'abc'],
			},
			data: ['abc', 'def', 'ghi'],
		};

		const expectedResult = {
			measurementId: 'measurement',
			result: {
				headers: {
					test: 'abc',
				},
				rawHeaders: 'test: abc',
				rawBody: 'abcdefghi',
				rawOutput: 'abcdefghi',
				statusCode: 200,
			},
			testId: 'test',
		};

		const stream = new PassThrough();
		const httpCmd = (_options: HttpOptions): Request => stream as never;

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
				statusCode: 200,
				headers: {test: 'abc'},
				rawHeaders: ['test', 'abc'],
			},
		};

		const expectedResult = {
			measurementId: 'measurement',
			result: {
				headers: {
					test: 'abc',
				},
				rawHeaders: 'test: abc',
				rawBody: '',
				rawOutput: 'status 200\ntest: abc',
				statusCode: 200,
			},
			testId: 'test',
		};

		const stream = new PassThrough();
		const httpCmd = (_options: HttpOptions): Request => stream as never;

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
			error: new Error('ENODATA google.com'),
		};

		const expectedResult = {
			measurementId: 'measurement',
			result: {
				headers: {},
				rawHeaders: '',
				rawBody: '',
				rawOutput: 'ENODATA google.com',
				statusCode: 0,
			},
			testId: 'test',
		};

		const stream = new PassThrough();
		const httpCmd = (_options: HttpOptions): Request => stream as never;

		const http = new HttpCommand(httpCmd);
		await http.run(mockedSocket as any, 'measurement', 'test', options);

		stream.emit('error', events.error);

		expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
		expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
	});
});
