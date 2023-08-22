import config from 'config';
import type { ExecaChildProcess, ExecaError, ExecaReturnValue } from 'execa';
import type { Socket } from 'socket.io-client';
import parse, { PingParseOutput } from '../command/handlers/ping/parse.js';
import type { PingOptions } from '../command/ping-command.js';
import { hasRequired } from './dependencies.js';
import { scopedLogger } from './logger.js';

const logger = scopedLogger('status-manager');

const INTERVAL_TIME = 10 * 60 * 1000; // 10 mins

export class StatusManager {
	private status: 'initializing' | 'ready' | 'unbuffer-missing' | 'ping-test-failed' | 'sigterm' = 'initializing';
	private timer?: NodeJS.Timeout;

	constructor (
		private readonly socket: Socket,
		private readonly pingCmd: (options: PingOptions) => ExecaChildProcess,
	) {}

	public async start () {
		// const hasRequiredDeps = await hasRequired();

		// if (!hasRequiredDeps) {
		// 	this.updateStatus('unbuffer-missing');
		// 	return;
		// }

		await this.runTest();
	}

	public stop (status: StatusManager['status']) {
		this.updateStatus(status);
		clearTimeout(this.timer);
	}

	public getStatus () {
		return this.status;
	}

	public updateStatus (status: StatusManager['status']) {
		this.status = status;
		this.sendStatus();
	}

	public sendStatus () {
		this.socket.emit('probe:status:update', this.status);
	}

	private async runTest () {
		// const result = await this.pingTest();

		// if (result) {
		this.updateStatus('ready');
		// } else {
		// 	this.updateStatus('ping-test-failed');
		// }

		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		this.timer = setTimeout(async () => {
			await this.runTest();
		}, INTERVAL_TIME);
	}

	private async pingTest () {
		const packets = config.get<number>('status.numberOfPackets');
		const targets = [ 'ns1.registry.in', 'k.root-servers.net', 'ns1.dns.nl' ];
		const results = await Promise.allSettled(targets.map(target => this.pingCmd({ type: 'ping', target, packets, inProgressUpdates: false })));

		const fulfilledPromises = results.filter((promise): promise is PromiseFulfilledResult<ExecaReturnValue> => promise.status === 'fulfilled');
		const cmdResults = fulfilledPromises.map(promise => promise.value).map(result => parse(result.stdout));
		const nonSuccessfulResults: Record<string, PingParseOutput> = {};
		const successfulResults = cmdResults.filter((result, index) => {
			const isSuccessful = result.status === 'finished' && result.stats?.loss === 0;

			if (!isSuccessful) {
				nonSuccessfulResults[targets[index]!] = result;
			}

			return isSuccessful;
		});

		const isPassingTest = successfulResults.length >= 2;
		const testPassText = isPassingTest ? '. Test pass' : '';

		const rejectedPromises = results.filter((promise): promise is PromiseRejectedResult => promise.status === 'rejected');
		rejectedPromises.forEach((promise) => {
			const reason = promise.reason as ExecaError;

			if (reason?.exitCode === 1) {
				const output = (reason).stdout || (reason).stderr || '';
				logger.warn(`Quality control ping test result is unsuccessful: ${output}${testPassText}.`);
			} else {
				logger.warn(`Quality control ping test result is unsuccessful${testPassText}:`, reason);
			}
		});

		Object.entries(nonSuccessfulResults).forEach(([ target, result ]) => {
			logger.warn(`Quality control ping test result is unsuccessful: ${target} ${result.stats?.loss?.toString() || ''}% packet loss${testPassText}.`);
		});

		if (!isPassingTest) {
			logger.warn('Quality control ping tests failed due to bad internet connection. Retrying in 10 minutes. Probe temporarily disconnected.');
		}

		return isPassingTest;
	}
}

let statusManager: StatusManager;

export const initStatusManager = (socket: Socket, pingCmd: (options: PingOptions) => ExecaChildProcess) => {
	statusManager = new StatusManager(socket, pingCmd);
	return statusManager;
};

export const getStatusManager = () => {
	if (!statusManager) {
		throw new Error('StatusManager is not initialized yet');
	}

	return statusManager;
};
