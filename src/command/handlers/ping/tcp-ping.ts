import { isIP } from 'node:net';
import { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import { dnsLookup, ResolverType } from '../shared/dns-resolver.js';
import type { PingParseOutput } from './parse.js';

export type InternalTcpPingOptions = {
	target: string;
	port: number;
	packets: number;
	timeout: number;
	interval: number;
	ipVersion: 4 | 6;
};

type TcpPingStartData = {
	type: 'start';
	address: string;
	hostname: string;
	port: number;
};

type TcpPingBaseProbeData = {
	type: 'probe';
	address: string;
	hostname: string;
	port: number;
};

type TcpPingSuccessProbeData = TcpPingBaseProbeData & {
	rtt: number;
	success: true;
};

type TcpPingFailProbeData = TcpPingBaseProbeData & {
	success: false;
};

type TcpPingProbeData = TcpPingSuccessProbeData | TcpPingFailProbeData;

type TcpPingStatsData = {
	type: 'statistics';
	address: string;
	hostname: string;
	port: number;
	min: number | undefined;
	avg: number | undefined;
	max: number | undefined;
	mdev: number | undefined;
	total: number;
	loss: number;
	rcv: number;
	drop: number;
	time: number;
};

type TcpPingErrorData = {
	type: 'error';
	message: string;
};

export type TcpPingData = TcpPingStartData | TcpPingProbeData | TcpPingStatsData | TcpPingErrorData;

/**
 * Performs a single TCP ping to the specified target and port
 * @param hostname The original hostname or IP address
 * @param address The resolved IP address
 * @param port The port to connect to
 * @param ipVersion 4 or 6
 * @param timeout The timeout in milliseconds
 */
export async function tcpPingSingle (hostname: string, address: string, port: number, ipVersion: number, timeout: number): Promise<TcpPingProbeData | TcpPingErrorData> {
	return new Promise((resolve) => {
		const startTime = performance.now();
		const socket = new Socket();

		socket.on('connect', () => {
			const endTime = performance.now();
			const rtt = endTime - startTime;
			resolve({ type: 'probe', address, hostname, port, rtt, success: true });
			socket.destroy();
		});

		socket.on('error', () => {
			resolve({ type: 'probe', address, hostname, port, success: false });
			socket.destroy();
		});

		socket.on('timeout', () => {
			resolve({ type: 'probe', address, hostname, port, success: false });
			socket.destroy();
		});

		socket.setNoDelay(true);
		socket.setTimeout(timeout);
		socket.connect({ port, host: address, family: ipVersion });
	});
}

/**
 * Performs multiple TCP pings to the specified target and port
 * @param options The TCP ping options
 * @param resolverFn Optional custom DNS resolver
 * @param onProgress Optional callback for progress updates
 * @returns A promise that resolves with the TCP ping results
 */
export async function tcpPing (
	options: InternalTcpPingOptions,
	onProgress?: (result: TcpPingData) => void,
	resolverFn?: ResolverType,
): Promise<Array<TcpPingData>> {
	const { target, port, packets, timeout, interval, ipVersion } = options;
	const startTime = performance.now();
	const results: Array<TcpPingData> = [];
	const successTimings: Array<TcpPingSuccessProbeData> = [];
	let address;

	if (isIP(target)) {
		address = target;
	} else {
		try {
			const dnsResolver = dnsLookup(undefined, resolverFn);
			[ address ] = await dnsResolver(target, { family: ipVersion });
		} catch (e) {
			return [{ type: 'error', message: (e as Error).message || '' }];
		}
	}

	const start = { type: 'start' as const, address, hostname: target, port };
	results.push(start);

	if (onProgress) {
		onProgress(start);
	}

	const pingPromises: Promise<void>[] = [];

	for (let i = 0; i < packets; i++) {
		if (i > 0) {
			await setTimeoutAsync(interval);
		}

		// The ping runs in a non-blocking way so that we can start a new one every `interval`.
		const pingPromise = tcpPingSingle(target, address, port, ipVersion, timeout).then(async (result) => {
			// Ensure we preserve the correct order.
			await Promise.all(pingPromises.slice(0, i));

			if (result.type === 'probe' && result.success) {
				successTimings.push(result);
			}

			if (onProgress) {
				onProgress(result);
			}

			results.push(result);
		});

		pingPromises.push(pingPromise);
	}

	await Promise.all(pingPromises);

	const rtts = successTimings.map(t => t.rtt);
	const min = rtts.length > 0 ? Math.min(...rtts) : undefined;
	const max = rtts.length > 0 ? Math.max(...rtts) : undefined;
	const avg = rtts.length > 0 ? rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length : undefined;

	const tsum = successTimings.reduce((sum, t) => sum + t.rtt, 0);
	const tsum2 = successTimings.reduce((sum, t) => sum + t.rtt ** 2, 0);
	const mdev = rtts.length > 0 ? Math.sqrt((tsum2 / successTimings.length) - (tsum / successTimings.length) ** 2) : undefined;

	results.push({
		type: 'statistics',
		hostname: target,
		address,
		port,
		min,
		max,
		avg,
		total: packets,
		rcv: successTimings.length,
		drop: packets - successTimings.length,
		loss: packets > 0 ? ((packets - successTimings.length) / packets) * 100 : 0,
		time: Math.round(performance.now() - startTime),
		mdev,
	});

	return results;
}

export function toRawTcpOutput (lines: TcpPingData[]): string {
	let probes = 0;

	return lines.map((line) => {
		switch (line.type) {
			case 'start':
				return `PING ${line.hostname} (${line.address}) on port ${line.port}.`;

			case 'probe': {
				probes++;

				return line.success
					? `Reply from ${line.hostname} (${line.address}) on port ${line.port}: tcp_conn=${probes} time=${formatNumber(line.rtt, 2)} ms`
					: `No reply from ${line.hostname} (${line.address}) on port ${line.port}: tcp_conn=${probes}`;
			}

			case 'statistics': {
				return [
					``,
					`--- ${line.hostname} (${line.address}) ping statistics ---`,
					`${line.total} packets transmitted, ${line.rcv ?? 0} received, ${roundNumber(line.loss)}% packet loss, time ${line.time} ms`,
					...line.rcv ? [ `rtt min/avg/max/mdev = ${line.min!.toFixed(3)}/${line.avg!.toFixed(3)}/${line.max!.toFixed(3)}/${line.mdev!.toFixed(3)} ms` ] : [],
				].join('\n');
			}

			default:
				return line.message;
		}
	}).join('\n');
}

/**
 * Formats TCP ping results to match the format expected by the ping command
 * @returns The formatted ping parse output
 * @param lines
 */
export function formatTcpPingResult (lines: Array<TcpPingData>): PingParseOutput {
	const startData = lines.find(line => line.type === 'start');
	const probeData = lines.filter(line => line.type === 'probe');
	const statsData = lines.find(line => line.type === 'statistics');
	const errorData = lines.filter(line => line.type === 'error');

	if (!startData || !probeData.length || !statsData || errorData.length) {
		const resolvedAddress = startData?.address;

		return {
			status: 'failed',
			rawOutput: toRawTcpOutput(lines),
			...resolvedAddress ? { resolvedAddress } : {},
		};
	}

	const timings = probeData.filter(t => t.success === true).map(probe => ({
		rtt: roundNumber(probe.rtt, 2),
	})).filter(t => !Number.isNaN(t.rtt));

	const stats = {
		min: roundNumber(statsData.min),
		max: roundNumber(statsData.max),
		avg: roundNumber(statsData.avg),
		total: Number(statsData.total),
		rcv: Number(statsData.rcv ?? 0),
		loss: roundNumber(statsData.loss),
		drop: Number(statsData.drop ?? 0),
	};

	return {
		status: 'finished',
		rawOutput: toRawTcpOutput(lines),
		resolvedHostname: startData.hostname,
		resolvedAddress: startData.address,
		timings,
		stats,
	};
}

function formatNumber (value: number | string, precision = 3): string {
	if (typeof value !== 'number') {
		value = Number(value);
	}

	for (let i = 0; i < precision; i++) {
		if (value < Math.pow(10, i + 1)) {
			return value.toFixed(precision - i);
		}
	}

	return value.toFixed(0);
}

function roundNumber (value: number | string | undefined, precision = 3): number {
	if (typeof value !== 'number') {
		value = Number(value);
	}

	for (let i = 0; i <= precision; i++) {
		if (value < Math.pow(10, i + 1)) {
			return Math.round(value * Math.pow(10, precision - i)) / Math.pow(10, precision - i);
		}
	}

	return Math.round(value);
}
