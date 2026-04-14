import config from 'config';
import type { Socket } from 'socket.io-client';
import parse from '../command/handlers/ping/parse.js';
import { tcpPing, TcpPingData } from '../command/handlers/ping/tcp-ping.js';
import type { PingOptions } from '../command/ping-command.js';
// import { scopedLogger } from '../lib/logger.js';

// const logger = scopedLogger('status-manager');

export class IcmpTcpTest {
	private diffs: number[] | null = null;
	private isProxy: boolean | null = null;

	constructor (
		private readonly updateStatus: (status: 'icmp-tcp-test-failed', value: boolean) => void,
		socket: Socket,
		private readonly pingCmd: (options: PingOptions) => Promise<{ stdout: string }>,
		private readonly runTcpPing: typeof tcpPing,
	) {
		socket.on('api:connect:isProxy', ({ isProxy }: { isProxy: boolean | null }) => {
			this.isProxy = isProxy;
			void this.evaluateAndUpdate();
		});
	}

	public async start () {
		await this.measureAllLocations();
		await this.evaluateAndUpdate();
	}

	public stop () {}

	private async evaluateAndUpdate () {
		if (this.diffs === null || this.isProxy === null) {
			return;
		}

		if (!this.isVpnDetected()) {
			this.updateStatus('icmp-tcp-test-failed', false);
			return;
		}

		// ICMP/TCP diff exceeds VPN threshold. Re-running to confirm.
		await this.measureAllLocations();
		this.updateStatus('icmp-tcp-test-failed', this.isVpnDetected());
	}

	private async measureAllLocations (): Promise<void> {
		const targets = config.get<string[]>('status.icmpTcpTargets');
		const results = await Promise.all(targets.map(target => this.measureDiff(target)));
		this.diffs = results.filter((d): d is number => d !== null);
	}

	// Returns icmpAvg - tcpAvg for a single target, or null on any error (treated as pass).
	private async measureDiff (target: string): Promise<number | null> {
		try {
			const [ icmpResult, tcpResults ] = await Promise.all([
				this.pingCmd({ type: 'ping', ipVersion: 4, target, packets: 3, protocol: 'ICMP', port: 80, inProgressUpdates: false }),
				this.runTcpPing({ target, port: 443, packets: 3, timeout: 10_000, interval: 500, ipVersion: 4 }),
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
		const over100 = this.diffs?.filter(d => d >= 100).length ?? 0;
		const over60 = this.diffs?.filter(d => d >= 60).length ?? 0;

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
	pingCmd: (options: PingOptions) => Promise<{ stdout: string }>,
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
