import { EventEmitter } from 'node:events';
import * as sinon from 'sinon';
import {expect} from 'chai';
import {Socket} from 'socket.io-client';
import {execaSync} from 'execa';
import {getCmdMock, getCmdMockProgress, getCmdMockResult, getExecaMock} from '../../utils.js';
import {
	PingCommand,
	argBuilder,
	type PingOptions,
} from '../../../src/command/ping-command.js';

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

		beforeEach(() => {
			sandbox.reset();
		});

		const successfulCommands = ['ping-success-linux', 'ping-success-mac'];
		for (const command of successfulCommands) {
			it(`should run and parse successful commands - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const outputProgress = getCmdMockProgress(command);
				const expectedResult = getCmdMockResult(command);

				const mockedCmd = getExecaMock();

				const ping = new PingCommand((): any => mockedCmd);

				const runPromise = ping.run(mockedSocket as any, 'measurement', 'test', {target: 'google.com'});
				outputProgress.forEach(progressOutput => mockedCmd.stdout.emit('data', Buffer.from(progressOutput, 'utf-8')));
				mockedCmd.resolve({stdout: rawOutput});
				await runPromise;

				expect(mockedSocket.emit.callCount).to.equal(2);
				expect(mockedSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:progress', {
						testId: 'test',
						measurementId: 'measurement',
						result: { rawOutput: outputProgress[0] }
				}]);
				expect(mockedSocket.emit.secondCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
			});
		}

		it(`should run and parse private ip command on the progress step`, async () => {
			const command = 'ping-private-ip-linux';
			const outputProgress = getCmdMockProgress(command);
			const expectedResult = getCmdMockResult(command);

			const mockedCmd = getExecaMock();

			const ping = new PingCommand((): any => mockedCmd);

			const runPromise = ping.run(mockedSocket as any, 'measurement', 'test', {target: 'google.com'});
			outputProgress.forEach(progressOutput => mockedCmd.stdout.emit('data', Buffer.from(progressOutput, 'utf-8')));
			await runPromise;

			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
		});

		it(`should run and parse private ip command on the result step`, async () => {
			const command = 'ping-private-ip-linux';
			const rawOutput = getCmdMock(command);
			const expectedResult = getCmdMockResult(command);

			const mockedCmd = getExecaMock();

			const ping = new PingCommand((): any => mockedCmd);

			const runPromise = ping.run(mockedSocket as any, 'measurement', 'test', {target: 'google.com'});
			mockedCmd.resolve({stdout: rawOutput});
			await runPromise;

			expect(mockedSocket.emit.calledOnce).to.be.true;
			expect(mockedSocket.emit.firstCall.args).to.deep.equal(['probe:measurement:result', expectedResult]);
		});


		const failedCommands = ['ping-timeout-linux', 'ping-timeout-mac'];
		for (const command of failedCommands) {
			it(`should run and parse failed commands - ${command}`, async () => {
				const rawOutput = getCmdMock(command);
				const expectedResult = getCmdMockResult(command);

				const execaError = execaSync('unknown-command', [], {reject: false});
				execaError.stdout = rawOutput;
				const mockedCmd = getExecaMock();

				const ping = new PingCommand((): any => mockedCmd);
				const runPromise = ping.run(mockedSocket as any, 'measurement', 'test', {target: 'google.com'});
				mockedCmd.reject(execaError);
				await runPromise;

				expect(mockedSocket.emit.calledOnce).to.be.true;
				expect(mockedSocket.emit.firstCall.args[0]).to.equal('probe:measurement:result');
				expect(mockedSocket.emit.firstCall.args[1]).to.deep.equal(expectedResult);
			});
		}
	});
});
