import config from 'config';

const processGrace = config.get<number>('commands.processGrace');

export const getLastPacketTime = (packets: number, interval: number): number => {
	return (packets - 1) * interval;
};

export const getPacketInterval = (packets: number, timeout: number, interval: number, minInterval: number): number => {
	return (packets - 1) * interval > timeout - 1 ? minInterval : interval;
};

export const getProcessTimeout = (timeout: number, grace = processGrace): number => {
	return (timeout + grace) * 1000;
};
