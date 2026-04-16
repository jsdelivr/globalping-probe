import config from 'config';
import type { ExecaChildProcess, ExecaError } from 'execa';
import type { Socket } from 'socket.io-client';
import parse from '../command/handlers/ping/parse.js';
import type { IpFamily } from '../command/handlers/shared/dns-resolver.js';
import type { PingOptions } from '../command/ping-command.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('status-manager');

const PING_INTERVAL_TIME = 10 * 60 * 1000; // 10 mins

export class PingTest {
	private timer?: NodeJS.Timeout;
	private stopped = true;

	constructor (
		private readonly updateStatus: (status: 'ping-test-failed', value: boolean) => void,
		private readonly socket: Socket,
		private readonly pingCmd: (options: PingOptions) => ExecaChildProcess,
	) {}

	public async start () {
		clearTimeout(this.timer);
		this.stopped = false;
		await this.runTests();
	}

	public stop () {
		this.stopped = true;
		clearTimeout(this.timer);
	}

	private async runTests () {
		const [ resultIPv4, resultIPv6 ] = await Promise.all([
			this.runPingTest(4),
			this.runPingTest(6),
		]);

		if (resultIPv4 || resultIPv6) {
			this.updateStatus('ping-test-failed', false);
		} else {
			this.updateStatus('ping-test-failed', true);
			logger.warn(`Both ping tests failed due to bad internet connection. Retrying in 10 minutes. Probe temporarily disconnected.`);
		}

		this.socket.emit('probe:isIPv4Supported:update', resultIPv4);
		this.socket.emit('probe:isIPv6Supported:update', resultIPv6);

		if (this.stopped) { return; }

		clearTimeout(this.timer);

		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		this.timer = setTimeout(async () => {
			await this.runTests();
		}, PING_INTERVAL_TIME);
	}

	private async runPingTest (ipVersion: IpFamily): Promise<boolean> {
		const packets = config.get<number>('status.numberOfPackets');
		const apiTarget = new URL(config.get<string>('api.httpHost')).hostname;
		const targets = [ apiTarget, apiTarget, apiTarget ];
		const rejectedResults: Array<{ target: string; reason: ExecaError }> = [];
		const successfulResults: Array<{ target: string }> = [];
		const unSuccessfulResults: Array<{ target: string; result: ReturnType<typeof parse> }> = [];

		for (const target of targets) {
			try {
				const result = await this.pingCmd({ type: 'ping', ipVersion, target, packets, protocol: 'ICMP', port: 80, inProgressUpdates: false });
				const parsed = parse(result.stdout);
				const isSuccessful = parsed.stats?.loss === 0;

				if (isSuccessful) {
					successfulResults.push({ target });
				} else {
					unSuccessfulResults.push({ target, result: parsed });
				}
			} catch (reason) {
				if (isExecaError(reason) && reason?.stdout?.toString()?.length) {
					const parsed = parse(reason.stdout.toString());
					const isSuccessful = parsed.stats?.loss === 0;

					if (isSuccessful) {
						successfulResults.push({ target });
					} else {
						unSuccessfulResults.push({ target, result: parsed });
					}
				} else {
					rejectedResults.push({ target, reason: reason as ExecaError });
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
			if (result.stats?.loss) {
				logger.warn(`IPv${ipVersion} ping test unsuccessful for ${target}: ${result.stats.loss.toString()}% packet loss${testPassText}.`);
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

let pingTest: PingTest;

export const initPingTest = (
	updateStatus: (status: 'ping-test-failed', value: boolean) => void,
	socket: Socket,
	pingCmd: (options: PingOptions) => ExecaChildProcess,
) => {
	pingTest = new PingTest(updateStatus, socket, pingCmd);
	return pingTest;
};

export const getPingTest = () => {
	if (!pingTest) {
		throw new Error('PingTest is not initialized yet');
	}

	return pingTest;
};
