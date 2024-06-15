import config from 'config';
import type { ExecaChildProcess, ExecaError } from 'execa';
import type { Socket } from 'socket.io-client';
import parse, { PingParseOutput } from '../command/handlers/ping/parse.js';
import type { PingOptions } from '../command/ping-command.js';
import { hasRequired } from './dependencies.js';
import { scopedLogger } from './logger.js';

const logger = scopedLogger('status-manager');

const INTERVAL_TIME = 10 * 60 * 1000; // 10 mins

export class StatusManager {
	private status: 'initializing' | 'ready' | 'unbuffer-missing' | 'ping-test-failed' | 'sigterm' = 'initializing';
	private isIPv4Supported: boolean = false;
	private isIPv6Supported: boolean = false;
	private timer?: NodeJS.Timeout;

	constructor (
		private readonly socket: Socket,
		private readonly pingCmd: (options: PingOptions) => ExecaChildProcess,
	) {}

	public async start () {
		// Remove the previous timer if any
		clearTimeout(this.timer);

		const hasRequiredDeps = await hasRequired();

		if (!hasRequiredDeps) {
			this.updateStatus('unbuffer-missing');
			return;
		}

		await this.runTest();
	}

	public stop (status: StatusManager['status']) {
		this.updateStatus(status);
		clearTimeout(this.timer);
	}

	public getStatus () {
		return this.status;
	}

	public getIsIPv4Supported () {
		return this.isIPv4Supported;
	}

	public getIsIPv6Supported () {
		return this.isIPv6Supported;
	}

	public updateStatus (status: StatusManager['status']) {
		this.status = status;
		this.sendStatus();
	}

	public updateIsIPv4Supported (isIPv4Supported : boolean) {
		this.isIPv4Supported = isIPv4Supported;
		this.sendIsIPv4Supported();
	}

	public updateIsIPv6Supported (isIPv6Supported : boolean) {
		this.isIPv6Supported = isIPv6Supported;
		this.sendIsIPv6Supported();
	}

	public sendStatus () {
		this.socket.emit('probe:status:update', this.status);
	}

	public sendIsIPv4Supported () {
		this.socket.emit('probe:isIPv4Supported:update', this.isIPv4Supported);
	}

	public sendIsIPv6Supported () {
		this.socket.emit('probe:isIPv6Supported:update', this.isIPv6Supported);
	}

	private async runTest () {
		const [ resultIPv4, resultIPv6 ] = await Promise.all([
			this.pingTest(4),
			this.pingTest(6),
		]);

		if (resultIPv4 || resultIPv6) {
			this.updateStatus('ready');
		} else {
			this.updateStatus('ping-test-failed');
			logger.warn(`Both ping tests failed due to bad internet connection. Retrying in 10 minutes. Probe temporarily disconnected.`);
		}

		this.updateIsIPv4Supported(resultIPv4);
		this.updateIsIPv6Supported(resultIPv6);

		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		this.timer = setTimeout(async () => {
			await this.runTest();
		}, INTERVAL_TIME);
	}

	private async pingTest (ipVersion: number) {
		const packets = config.get<number>('status.numberOfPackets');
		const targets = [ 'ns1.registry.in', 'k.root-servers.net', 'ns1.dns.nl' ];
		const results = await Promise.allSettled(targets.map(target => this.pingCmd({ type: 'ping', ipVersion, target, packets, inProgressUpdates: false })));

		const rejectedResults: Array<{ target: string, reason: ExecaError }> = [];
		const successfulResults: Array<{ target: string, result: PingParseOutput }> = [];
		const unSuccessfulResults: Array<{ target: string, result: PingParseOutput }> = [];

		for (const [ index, result ] of results.entries()) {
			if (result.status === 'rejected') {
				rejectedResults.push({ target: targets[index]!, reason: result.reason as ExecaError });
			} else {
				const parsed = parse(result.value.stdout);
				const isSuccessful = parsed.stats?.loss === 0;

				if (isSuccessful) {
					successfulResults.push({ target: targets[index]!, result: parsed });
				} else {
					unSuccessfulResults.push({ target: targets[index]!, result: parsed });
				}
			}
		}

		const isPassingTest = successfulResults.length >= 2;
		const testPassText = isPassingTest ? `. IPv${ipVersion} tests pass` : '';

		rejectedResults.forEach(({ reason }) => {
			if (!reason.exitCode) {
				logger.warn(`IPv${ipVersion} ping test unsuccessful${testPassText}:`, reason);
			} else {
				const output = (reason).stdout || (reason).stderr || '';
				logger.warn(`IPv${ipVersion} ping test unsuccessful: ${output}${testPassText}.`);
			}
		});

		unSuccessfulResults.forEach(({ target, result }) => {
			logger.warn(`IPv${ipVersion} ping test unsuccessful for ${target}: ${result.stats?.loss?.toString() || ''}% packet loss${testPassText}.`);
		});

		if (!isPassingTest) {
			logger.warn(`IPv${ipVersion} ping tests failed. Retrying in 10 minutes. Probe marked as not supporting IPv${ipVersion}.`);
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
