import PassThrough from 'node:stream';
import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult, execaPromise} from '../../utils.js';
import {MtrCommand} from '../../../src/command/mtr-command.js';
import type {MtrOptions} from '../../../src/command/mtr-command.js';

const dnsResolver = (isPrivate: boolean) => async (_addr: string, type = 'A') => {
	if (type === 'TXT') {
		return ['123 | abc | abc'];
	}

	if (isPrivate) {
		return ['192.168.0.1'];
	}

	return ['1.1.1.1'];
};

describe('mtr command executor', () => {
	const sandbox = sinon.createSandbox();
	const mockedSocket = sandbox.createStubInstance(Socket);

	beforeEach(() => {
		sandbox.reset();
	});

	it('should run and parse mtr', async () => {
		const testCase = 'mtr-success-raw';
		const options = {
			type: 'mtr' as const,
			target: 'jsdelivr.net',
		};

		const expectedResult = getCmdMockResult(testCase);
		const rawOutput = getCmdMock(testCase);
		const rawOutputLines = rawOutput.split('\n');

		const stream = new PassThrough();
		const promise = new Promise(resolve => {
			for (const [i, line] of rawOutputLines.entries()) {
				setTimeout(() => stream.emit('data', Buffer.from(line), i));
			}

			// Simulate raw output - wait until all lines are emitted.
			setTimeout(() => {
				resolve(rawOutput);
			}, rawOutputLines.length);
		});

		const mockCmd = execaPromise({stdout: stream}, promise);

		const mtr = new MtrCommand((): any => mockCmd, dnsResolver(false));
		await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

		expect(mockedSocket.emit.args.length).to.equal(rawOutputLines.length + 1); // Progress + result
		expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
		expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
	});

	it('should detect Private IP and stop', async () => {
		const testCase = 'mtr-fail-private-ip';
		const options = {
			type: 'mtr' as const,
			target: 'jsdelivr.net',
		};

		const expectedResult = getCmdMockResult(testCase);
		const mockCmd = execaPromise({stdout: new PassThrough(), kill: () => null}, Promise.resolve());

		const mtr = new MtrCommand((): any => mockCmd, dnsResolver(true));
		await mtr.run(mockedSocket as any, 'measurement', 'test', options as MtrOptions);

		expect(mockedSocket.emit.lastCall.args[0]).to.equal('probe:measurement:result');
		expect(mockedSocket.emit.lastCall.args[1]).to.deep.equal(expectedResult);
	});
});
