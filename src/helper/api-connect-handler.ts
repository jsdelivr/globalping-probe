import type { Socket } from 'socket.io-client';
import { scopedLogger } from '../lib/logger.js';
import type { ProbeLocation } from '../types.js';
import { getDnsServers } from '../lib/dns.js';

const logger = scopedLogger('api:connect:location');

export const apiConnectLocationHandler = (socket: Socket) => async (data: ProbeLocation): Promise<void> => {
	logger.info(`Connected from ${data.city}, ${data.country}, ${data.continent} (${data.network}, ASN: ${data.asn}, lat: ${data.latitude} long: ${data.longitude}).`);
	const dnsList = getDnsServers();
	socket.emit('probe:dns:update', dnsList);
};
