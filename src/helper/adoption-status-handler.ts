import { scopedLogger } from '../lib/logger.js';
import { startLocalAdoptionServer, stopLocalAdoptionServer } from '../lib/adoption-server.js';
import { getLocalIps } from '../lib/private-ip.js';
import type { Socket } from 'socket.io-client';

const logger = scopedLogger('api:connect:adoption');

export const adoptionStatusHandler = (socket: Socket) => async ({ message, adopted, level }: { message: string; adopted: boolean; level?: 'info' | 'warn' | 'error' }): Promise<void> => {
	logger[level || 'info'](message);

	if (!adopted && process.env['GP_HOST_HW']) {
		const { expiresAt, token } = startLocalAdoptionServer();
		const localProbeIps = Array.from(getLocalIps()).slice(0, 32);

		socket.emit('probe:adoption:ready', {
			token,
			expiresAt,
			ips: localProbeIps,
		});
	} else {
		stopLocalAdoptionServer();
	}
};
