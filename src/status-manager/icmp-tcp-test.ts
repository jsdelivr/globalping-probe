import config from 'config';
import type { Socket } from 'socket.io-client';
import type { ExecaChildProcess } from 'execa';
import parse from '../command/handlers/ping/parse.js';
import { tcpPing, TcpPingData } from '../command/handlers/ping/tcp-ping.js';
import type { PingOptions } from '../command/ping-command.js';
import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('status-manager');

const ICMP_TCP_INTERVAL_TIME = 60 * 60 * 1000; // 1 hour

export class IcmpTcpTest {
	private timer?: NodeJS.Timeout;
	private stopped = true;
	private diffsIPv4: (number | null)[] | null = null;
	private diffsIPv6: (number | null)[] | null = null;
	private isProxy: boolean | null = null;

	constructor (
		private readonly updateStatus: (status: 'icmp-tcp-test-failed', value: boolean) => void,
		socket: Socket,
		private readonly pingCmd: (options: PingOptions) => ExecaChildProcess,
		private readonly runTcpPing: typeof tcpPing,
	) {
		socket.on('api:connect:isProxy', async ({ isProxy }: { isProxy: boolean }) => {
			this.isProxy = isProxy;
			await this.evaluateAndUpdate();
		});
	}

	public async start () {
		clearTimeout(this.timer);
		this.stopped = false;
		await this.runScheduledCycle();
	}

	public stop () {
		this.stopped = true;
		clearTimeout(this.timer);
	}

	private async runScheduledCycle () {
		await this.measureAllLocations();
		await this.evaluateAndUpdate();

		if (this.stopped) { return; }

		clearTimeout(this.timer);

		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		this.timer = setTimeout(async () => {
			await this.runScheduledCycle();
		}, ICMP_TCP_INTERVAL_TIME);
	}

	private async evaluateAndUpdate () {
		if (this.diffsIPv4 === null || this.diffsIPv6 === null || this.isProxy === null) {
			return;
		}

		if (!this.isVpnDetected()) {
			this.updateStatus('icmp-tcp-test-failed', false);
			return;
		}

		// ICMP/TCP diff exceeds VPN threshold. Re-running to confirm.
		await this.measureAllLocations();
		const failed = this.isVpnDetected();
		this.updateStatus('icmp-tcp-test-failed', failed);

		if (failed) {
			const targets = config.get<string[]>('status.icmpTcpTargets');
			logger.warn(
				'ICMP/TCP ping RTT diff exceeds threshold. Retrying in 1 hour. Probe temporarily disconnected.',
				{
					ipv4: targets.map((t, i) => ({ targets: t, diff: this.diffsIPv4?.[i] })),
					ipv6: targets.map((t, i) => ({ targets: t, diff: this.diffsIPv6?.[i] })),
					isProxy: this.isProxy,
				},
			);
		}
	}

	private async measureAllLocations (): Promise<void> {
		const targets = config.get<string[]>('status.icmpTcpTargets');
		this.diffsIPv4 = await Promise.all(targets.map(target => this.measureDiff(target, 4)));
		this.diffsIPv6 = await Promise.all(targets.map(target => this.measureDiff(target, 6)));
	}

	// Returns icmpAvg - tcpAvg for a single target, or null on any error (treated as pass).
	private async measureDiff (target: string, ipVersion: 4 | 6): Promise<number | null> {
		try {
			const [ icmpResult, tcpResults ] = await Promise.all([
				this.pingCmd({ type: 'ping', ipVersion, target, packets: 3, protocol: 'ICMP', port: 80, inProgressUpdates: false }),
				this.runTcpPing({ target, port: 443, packets: 3, timeout: 10_000, interval: 500, ipVersion }),
			]);

			const icmpAvg = parse(icmpResult.stdout).stats?.avg ?? null;
			const statsEntry = tcpResults.find((r): r is Extract<TcpPingData, { type: 'statistics' }> => r.type === 'statistics');
			const tcpAvg = statsEntry?.avg ?? null;

			if (icmpAvg === null || tcpAvg === null) { return null; }

			if (!Number.isFinite(icmpAvg) || !Number.isFinite(tcpAvg)) { return null; }

			return icmpAvg - tcpAvg;
		} catch {
			return null;
		}
	}

	private isVpnDetected (): boolean {
		return this.isVpn(this.diffsIPv4) || this.isVpn(this.diffsIPv6);
	}

	private isVpn (diffs: (number | null)[] | null): boolean {
		const numeric = diffs?.filter((d): d is number => d !== null) ?? [];
		const over100 = numeric.filter(d => d >= 100).length;
		const over60 = numeric.filter(d => d >= 60).length;

		if (over100 >= 1) { return true; }

		if (over60 >= 2) { return true; }

		if (over60 >= 1 && this.isProxy === true) { return true; }

		return false;
	}
}

let icmpTcpTest: IcmpTcpTest;

export const initIcmpTcpTest = (
	updateStatus: (status: 'icmp-tcp-test-failed', value: boolean) => void,
	socket: Socket,
	pingCmd: (options: PingOptions) => ExecaChildProcess,
	runTcpPing: typeof tcpPing = tcpPing,
) => {
	icmpTcpTest = new IcmpTcpTest(updateStatus, socket, pingCmd, runTcpPing);
	return icmpTcpTest;
};

export const getIcmpTcpTest = () => {
	if (!icmpTcpTest) {
		throw new Error('IcmpTcpTest is not initialized yet');
	}

	return icmpTcpTest;
};
