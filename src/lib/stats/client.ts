import type {Socket} from 'socket.io-client';
import {getConfValue} from '../config.js';
import {getCpuUsage} from './cpu.js';

type Worker = {
	jobs: Map<string, number>;
};

const statsConfig = getConfValue<{interval: number}>('stats');

export const report = async (socket: Socket, jobCount: number) => {
	const cpuUsage = await getCpuUsage();

	socket.emit('probe:stats:report', {
		cpu: cpuUsage,
		jobs: {
			count: jobCount,
		},
	});
};

export const run = (socket: Socket, worker: Worker) => {
	setInterval(async () => {
		await report(socket, worker.jobs.size);
	}, statsConfig.interval * 1000);
};
