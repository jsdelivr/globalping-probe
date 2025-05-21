import config from 'config';
import type { Socket } from 'socket.io-client';
import { scopedLogger } from '../logger.js';
import { getCpuUsage } from './cpu.js';

const logger = scopedLogger('probe:stats:report');

type Worker = {
	jobs: Map<string, number>;
};

const statsConfig = config.get<{ interval: number }>('stats');

const report = async (socket: Socket, jobCount: number) => {
	const cpuUsage = await getCpuUsage();

	socket.emit('probe:stats:report', {
		cpu: cpuUsage,
		jobs: {
			count: jobCount,
		},
	});
};

export const run = (socket: Socket, worker: Worker) => {
	setInterval(() => {
		report(socket, worker.jobs.size)
			.catch((error: unknown) => {
				logger.error('Unknown error', error);
			});
	}, statsConfig.interval * 1000);
};
