import config from 'config';
import { randomUUID } from 'node:crypto';
import type { ExecaChildProcess, ExecaError } from 'execa';
import { TTLCache } from '@isaacs/ttlcache';
import type { Socket } from 'socket.io-client';
import parse, { PingParseOutput } from '../command/handlers/ping/parse.js';
import type { IpFamily } from '../command/handlers/shared/dns-resolver.js';
import type { PingOptions } from '../command/ping-command.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { hasRequired } from './dependencies.js';
import { scopedLogger } from './logger.js';

const logger = scopedLogger('status-manager');

const PING_INTERVAL_TIME = 10 * 60 * 1000; // 10 mins
const DISCONNECTS_TTL = 5 * 60 * 1000; // 5 mins
const MAX_DISCONNECTS_COUNT = 3;

export class StatusManager {
	private statuses: {
		'unbuffer-missing': boolean;
		'ping-test-failed': boolean | null;
		'too-many-disconnects': boolean;
		'sigterm': boolean;
	} = {
			'unbuffer-missing': false,
			'ping-test-failed': null,
			'too-many-disconnects': false,
			'sigterm': false,
		};

	private isIPv4Supported: boolean = false;
	private isIPv6Supported: boolean = false;
	private readonly disconnects = new TTLCache<string, number>({
		ttl: DISCONNECTS_TTL,
		dispose: () => {
			if (this.disconnects.size === 0) {
				this.updateStatus('too-many-disconnects', false);
			}
		},
	});

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
			this.updateStatus('unbuffer-missing', true);
			return;
		} else if (this.statuses['unbuffer-missing']) {
			this.updateStatus('unbuffer-missing', false);
		}

		await this.runTest();
	}

	public stop () {
		this.updateStatus('sigterm', true);
		clearTimeout(this.timer);
	}

	public getIsIPv4Supported () {
		return this.isIPv4Supported;
	}

	public getIsIPv6Supported () {
		return this.isIPv6Supported;
	}

	public updateIsIPv4Supported (isIPv4Supported: boolean) {
		this.isIPv4Supported = isIPv4Supported;
		this.sendIsIPv4Supported();
	}

	public updateIsIPv6Supported (isIPv6Supported: boolean) {
		this.isIPv6Supported = isIPv6Supported;
		this.sendIsIPv6Supported();
	}

	public getStatus () {
		if (this.statuses.sigterm) {
			return 'sigterm';
		}

		if (this.statuses['unbuffer-missing']) {
			return 'unbuffer-missing';
		}

		if (this.statuses['ping-test-failed'] === null) {
			return 'initializing';
		}

		if (this.statuses['ping-test-failed']) {
			return 'ping-test-failed';
		}

		if (this.statuses['too-many-disconnects']) {
			return 'too-many-disconnects';
		}

		return 'ready';
	}

	public updateStatus (status: keyof StatusManager['statuses'], value: boolean) {
		if (this.statuses[status] === value) {
			return;
		}

		this.statuses[status] = value;
		this.sendStatus();
	}

	public sendStatus () {
		this.socket.emit('probe:status:update', this.getStatus());
	}

	public sendIsIPv4Supported () {
		this.socket.emit('probe:isIPv4Supported:update', this.isIPv4Supported);
	}

	public sendIsIPv6Supported () {
		this.socket.emit('probe:isIPv6Supported:update', this.isIPv6Supported);
	}

	public reportDisconnect () {
		this.disconnects.set(randomUUID(), Date.now());

		if (this.disconnects.size >= MAX_DISCONNECTS_COUNT) {
			this.updateStatus('too-many-disconnects', true);
		}
	}

	private async runTest () {
		const [ resultIPv4, resultIPv6 ] = await Promise.all([
			this.pingTest(4),
			this.pingTest(6),
		]);

		if (resultIPv4 || resultIPv6) {
			this.updateStatus('ping-test-failed', false);
		} else {
			this.updateStatus('ping-test-failed', true);
			logger.warn(`Both ping tests failed due to bad internet connection. Retrying in 10 minutes. Probe temporarily disconnected.`);
		}

		this.updateIsIPv4Supported(resultIPv4);
		this.updateIsIPv6Supported(resultIPv6);

		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		this.timer = setTimeout(async () => {
			await this.runTest();
		}, PING_INTERVAL_TIME);
	}

	private async pingTest (ipVersion: IpFamily) {
		const packets = config.get<number>('status.numberOfPackets');
		const packetLossThreshold = config.get<number>('status.packetLossThreshold');
		const apiTarget = new URL(config.get<string>('api.httpHost')).hostname;
		const targets = [ apiTarget ];
		const results = await Promise.allSettled(targets.map(target => this.pingCmd({ type: 'ping', ipVersion, target, packets, protocol: 'ICMP', port: 80, inProgressUpdates: false })));

		const rejectedResults: Array<{ target: string; reason: ExecaError }> = [];
		const successfulResults: Array<{ target: string; result: PingParseOutput }> = [];
		const unSuccessfulResults: Array<{ target: string; result: PingParseOutput }> = [];

		for (const [ index, result ] of results.entries()) {
			if (result.status === 'rejected' && (!isExecaError(result.reason) || !result.reason?.stdout?.toString()?.length)) {
				rejectedResults.push({ target: targets[index]!, reason: result.reason as ExecaError });
			} else {
				const stdout = result.status === 'fulfilled'
					? result.value.stdout
					: (isExecaError(result.reason) && result.reason?.stdout?.toString()) || '';

				const parsed = parse(stdout);
				const isSuccessful = typeof parsed.stats?.loss === 'number' && parsed.stats.loss <= packetLossThreshold;

				if (isSuccessful) {
					successfulResults.push({ target: targets[index]!, result: parsed });
				} else {
					unSuccessfulResults.push({ target: targets[index]!, result: parsed });
				}
			}
		}

		const isPassingTest = successfulResults.length === targets.length;
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
			if (typeof result.stats?.loss === 'number') {
				logger.warn(`IPv${ipVersion} ping test unsuccessful for ${target}: ${result.stats.loss.toString()}% packet loss (threshold: ${packetLossThreshold}%)${testPassText}.`);
			} else {
				logger.warn(`IPv${ipVersion} ping test unsuccessful for ${target}: ${result.rawOutput}${testPassText}.`);
			}
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
