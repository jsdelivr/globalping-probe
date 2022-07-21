import type {Socket} from 'socket.io-client';
import {scopedLogger} from '../lib/logger.js';
import type {ProbeLocation} from '../types.js';
import {hasRequired as hasRequiredDeps} from '../lib/dependencies.js';
import {getDnsServers} from '../lib/dns.js';

const logger = scopedLogger('api:connect');

export const apiConnectLocationHandler = (socket: Socket) => async (data: ProbeLocation): Promise<void> => {
	logger.info(`connected from (${data.city}, ${data.country}, ${data.continent}) (lat: ${data.latitude} long: ${data.longitude})`);

	if (await hasRequiredDeps()) {
		socket.emit('probe:status:ready', {});
	} else {
		socket.emit('probe:status:not_ready', {});
	}

	const dnsList = getDnsServers();
	socket.emit('probe:dns:update', {list: dnsList});
};
