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
};

type MtrBudget = {
	interval: number;
	grace: number;
	nativeTimeout: number;
};

const roundDown = (value: number, places = 2): number => {
	const scale = 10 ** places;
	return Math.floor((value + 1e-9) * scale) / scale;
};

export const getPingBudget = (packets: number, timeout: number, maxInterval = pingConfig.interval): PingBudget => {
	const minimumDnsHeadroom = 1;
	const minimumResponseTimeout = 1;
	const dnsHeadroomShare = 0.2;
	const preferredDnsHeadroomFloor = 2;
	const preferredResponseTimeout = 3;
	const maximumResponseTimeout = 5;
	const packetGaps = packets - 1;
	let interval = packetGaps === 0 ? maxInterval : pingConfig.minInterval;
	let remaining = timeout - packetGaps * interval;

	const take = (requested: number): number => {
		const allocated = Math.max(0, Math.min(requested, remaining));
		remaining -= allocated;
		return allocated;
	};

	let dnsHeadroom = take(minimumDnsHeadroom);
	let responseTimeout = take(minimumResponseTimeout);
	const preferredDnsHeadroom = Math.max(preferredDnsHeadroomFloor, timeout * dnsHeadroomShare);
	dnsHeadroom += take(preferredDnsHeadroom - dnsHeadroom);
	responseTimeout += take(preferredResponseTimeout - responseTimeout);

	const intervalUpgradeCost = packetGaps * (maxInterval - interval);
	const responseUpgrade = maximumResponseTimeout - responseTimeout;
	const combinedUpgradeCost = intervalUpgradeCost + responseUpgrade;
	const progress = combinedUpgradeCost === 0 ? 0 : Math.min(1, remaining / combinedUpgradeCost);

	interval += (maxInterval - interval) * progress;
	responseTimeout += responseUpgrade * progress;
	remaining -= combinedUpgradeCost * progress;
	dnsHeadroom += remaining;

	return {
		interval: roundDown(interval),
		responseTimeout: roundDown(responseTimeout),
		dnsHeadroom: roundDown(dnsHeadroom),
	};
};

export const getTracerouteBudget = (timeout: number, packets: number): TracerouteBudget => {
	const maximumWait = 5;
	const probeTimeoutShare = 0.6;
	const wait = Math.min(maximumWait, roundDown(timeout * probeTimeoutShare / packets));

	return { wait };
};

export const getMtrBudget = (packets: number, remaining: number): MtrBudget => {
	const minimumGrace = 1;
	const maximumGrace = 3;
	const minimumNativeTimeout = 1;
	const grace = Math.min(maximumGrace, Math.max(minimumGrace, Math.floor(remaining - packets * mtrConfig.minInterval)));
	const calculatedInterval = Math.min(mtrConfig.interval, Math.max(mtrConfig.minInterval, (remaining - grace) / packets));
	const interval = roundDown(calculatedInterval);
	const nativeTimeout = Math.max(minimumNativeTimeout, Math.floor(remaining - packets * interval));

	return { interval, grace, nativeTimeout };
};

export const getProcessTimeout = (timeout: number, grace = processGrace): number => {
	return (timeout + grace) * 1000;
};
