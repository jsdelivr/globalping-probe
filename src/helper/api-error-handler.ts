import type { Socket } from 'socket.io-client';
import { scopedLogger } from '../lib/logger.js';
import type { WsApiError } from '../types.js';

const logger = scopedLogger('api:error');

const IP_LIMIT_TIMEOUT = 60_000;

class ErrorHandler {
	private lastErrorCode: WsApiError['info']['code'] | null = null;

	constructor (private readonly socket: Socket) {}

	handleApiError = (error: WsApiError): void => {
		this.lastErrorCode = error.info.code;
		logger.error(`disconnected due to error (${error.info.socketId}):`, error);

		if (error.info.code === 'ip_limit') {
			logger.info('Only 1 connection per IP address is allowed. Please make sure you don\'t have another instance of the probe running.');
		}

		if (error.info.probe) {
			const location = error.info.probe?.location;
			logger.debug(`attempted to connect from (${location.city}, ${location.country}, ${location.continent}) (lat: ${location.latitude} long: ${location.longitude})`);
		}
	};

	handleDisconnect = (reason: string): void => {
		logger.debug(`disconnected from API: (${reason})`);
		const lastErrorCode = this.lastErrorCode;
		this.lastErrorCode = null;

		if (reason === 'io server disconnect') {
			if (lastErrorCode === 'ip_limit') {
				setTimeout(() => {
					this.socket.connect();
				}, IP_LIMIT_TIMEOUT);
			} else {
				this.socket.connect();
			}
		}
	};
}

export const initErrorHandler = (socket: Socket) => {
	const errorHandler = new ErrorHandler(socket);
	return errorHandler;
};
