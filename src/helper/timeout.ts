import config from 'config';

const processGrace = config.get<number>('commands.processGrace');
const pingConfig = config.get<{ interval: number; minInterval: number }>('commands.ping');
const mtrConfig = config.get<{ interval: number; minInterval: number }>('commands.mtr');

type PingBudget = {
	interval: number;
	responseTimeout: number;
	dnsHeadroom: number;
};

type TracerouteBudget = {
	wait: number;
	dnsHeadroom: number;
};

type MtrBudget = {
	interval: number;
	grace: number;
	nativeTimeout: number;
	dnsHeadroom: number;
};

const roundDown = (value: number, places = 2): number => {
	const scale = 10 ** places;
	return Math.floor((value + 1e-9) * scale) / scale;
};

export const getPingBudget = (packets: number, timeoutSeconds: number, intervalOverride?: number): PingBudget => {
	const minimumDnsHeadroom = 1;
	const minimumResponseTimeout = 1;
	const dnsHeadroomShare = 0.2;
	const preferredDnsHeadroomFloor = 2;
	const preferredResponseTimeout = 3;
	const maximumResponseTimeout = 5;
	const targetInterval = intervalOverride ?? pingConfig.interval;
	const packetGaps = packets - 1;
	let interval = intervalOverride ?? (packetGaps === 0 ? targetInterval : pingConfig.minInterval);
	let remaining = timeoutSeconds - packetGaps * interval;

	const take = (requested: number): number => {
		const allocated = Math.max(0, Math.min(requested, remaining));
		remaining -= allocated;
		return allocated;
	};

	let dnsHeadroom = take(minimumDnsHeadroom);
	let responseTimeout = take(minimumResponseTimeout);
	const preferredDnsHeadroom = Math.max(preferredDnsHeadroomFloor, timeoutSeconds * dnsHeadroomShare);
	dnsHeadroom += take(preferredDnsHeadroom - dnsHeadroom);
	responseTimeout += take(preferredResponseTimeout - responseTimeout);

	const intervalUpgrade = intervalOverride === undefined ? targetInterval - interval : 0;
	const intervalUpgradeCost = packetGaps * intervalUpgrade;
	const responseUpgrade = maximumResponseTimeout - responseTimeout;
	const combinedUpgradeCost = intervalUpgradeCost + responseUpgrade;
	const progress = combinedUpgradeCost === 0 ? 0 : Math.min(1, remaining / combinedUpgradeCost);

	interval += intervalUpgrade * progress;
	responseTimeout += responseUpgrade * progress;
	remaining -= combinedUpgradeCost * progress;
	dnsHeadroom += remaining;

	return {
		interval: roundDown(interval),
		responseTimeout: roundDown(responseTimeout),
		dnsHeadroom: roundDown(dnsHeadroom),
	};
};

export const getTracerouteBudget = (timeoutSeconds: number, packets: number): TracerouteBudget => {
	const maximumWait = 5;
	const probeTimeoutShare = 0.6;
	const wait = Math.min(maximumWait, roundDown(timeoutSeconds * probeTimeoutShare / packets));

	return { wait, dnsHeadroom: roundDown(timeoutSeconds - packets * wait) };
};

export const getMtrBudget = (packets: number, timeoutSeconds: number): MtrBudget => {
	const minimumResponseTimeout = 1;
	const preferredResponseTimeout = 3;
	const maximumResponseTimeout = 5;
	const preferredDnsHeadroomFloor = 2;
	const dnsHeadroomShare = 0.2;
	const packetGaps = packets - 1;
	let interval = packetGaps === 0 ? mtrConfig.interval : mtrConfig.minInterval;
	let responseTimeout = minimumResponseTimeout;
	let remaining = timeoutSeconds - packetGaps * interval - responseTimeout;

	const take = (requested: number): number => {
		const allocated = Math.max(0, Math.min(requested, remaining));
		remaining -= allocated;
		return allocated;
	};

	take(Math.max(preferredDnsHeadroomFloor, timeoutSeconds * dnsHeadroomShare));
	responseTimeout += take(preferredResponseTimeout - responseTimeout);

	const intervalUpgrade = mtrConfig.interval - interval;
	interval += take(packetGaps * intervalUpgrade) / Math.max(packetGaps, 1);
	responseTimeout += take(maximumResponseTimeout - responseTimeout);

	interval = roundDown(interval);
	responseTimeout = roundDown(responseTimeout);
	const grace = roundDown(responseTimeout - interval);
	const nativeTimeout = Math.ceil(responseTimeout);
	const dnsHeadroom = roundDown(timeoutSeconds - packets * interval - grace);

	return { interval, grace, nativeTimeout, dnsHeadroom };
};

export const getProcessTimeout = (timeoutSeconds: number, graceSeconds = processGrace): number => {
	return Math.round((timeoutSeconds + graceSeconds) * 1000);
};

export const createMeasurementDeadline = (timeoutSeconds: number) => {
	const deadline = Date.now() + timeoutSeconds * 1000;
	const remainingMs = () => Math.max(deadline - Date.now(), 0);

	return {
		remainingMs,
		signal: () => AbortSignal.timeout(remainingMs()),
		signalFor: (timeoutSeconds: number) => AbortSignal.timeout(Math.round(timeoutSeconds * 1000)),
		processTimeout: () => getProcessTimeout(remainingMs() / 1000),
	};
};
