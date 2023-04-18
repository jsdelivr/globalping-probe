import { scopedLogger } from '../lib/logger.js';
import type { WsApiError } from '../types.js';

const logger = scopedLogger('api:error');

export const apiErrorHandler = (error: WsApiError): void => {
	logger.error(`disconnected due to error (${error.info.socketId}):`, error);

	if (error.info.code === 'ip_limit') {
		logger.info('Only 1 connection per IP address is allowed. Please make sure you don\'t have another instance of the probe running.');
	}

	if (error.info.probe) {
		const location = error.info.probe?.location;
		logger.debug(`attempted to connect from (${location.city}, ${location.country}, ${location.continent}) (lat: ${location.latitude} long: ${location.longitude})`);
	}
};
