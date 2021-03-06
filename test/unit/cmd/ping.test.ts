import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {getCmdMock, getCmdMockResult} from '../../utils.js';
import {
	PingCommand,
	argBuilder,
} from '../../../src/command/ping-command.js';
import type {PingOptions} from '../../../src/command/ping-command.js';

describe('ping command executor', () => {
	describe('argument builder', () => {
		it('should include all arguments', () => {
			const options = {
				type: 'ping' as PingOptions['type'],
				target: 'google.com',
				packets: 1,
			};

			const args = argBuilder(options);
			const joinedArgs = args.join(' ');

			expect(args[0]).to.equal('-4');
			expect(args[args.length - 1]).to.equal(options.target);
			expect(joinedArgs).to.contain(`-c ${options.packets}`);
			expect(joinedArgs).to.contain('-i 0.2');
			expect(joinedArgs).to.contain('-w 15');
		});

		describe('packets', () => {
			it('should set -c 2 flag', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
					target: 'google.com',
					packets: 2,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain('-c 2');
			});

			it('should set -c 5 flag', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
					target: 'google.com',
					packets: 5,
				};

				const args = argBuilder(options);

				expect(args.join(' ')).to.contain('-c 5');
			});
		});

		describe('target', () => {
			it('should set target at the end of array', () => {
				const options = {
					type: 'ping' as PingOptions['type'],
					target: 'abc.com',
					packets: 2,
				};

				const args = argBuilder(options);

				expect(args[args.length - 1]).to.equal('abc.com');
			});
		});
	});

	describe('command handler', () => {
		const sandbox = sinon.createSandbox();
		const mockedSocket = sandbox.createStubInstance(Socket);

		const testCases = ['ping-success-linux', 'ping-timeout-linux', 'ping-success-mac', 'ping-timeout-mac', 'ping-private-ip-linux'];

		beforeEach(() => {
			sandbox.reset();
		});

		for (const testCase of testCases) {
			it(`should run and parse ping - ${testCase}`, async () => {
				const rawOutput = getCmdMock(testCase);
				const expectedResult = getCmdMockResult(testCase);

				const mockedCmd = Promise.resolve({stdout: rawOutput});

				const ping = new PingCommand((): any => mockedCmd);
				await ping.run(mockedSocket as any, 'measurement', 'test', {target: 'google.com'});

				expect(mockedSocket.emit.calledOnce).to.be.true;
				expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
				expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
			});
		}
	});
});
