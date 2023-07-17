import type { Socket } from 'socket.io-client';
import { scopedLogger } from '../lib/logger.js';
import type { WsApiError } from '../types.js';

const logger = scopedLogger('api:error');

const IP_LIMIT_TIMEOUT = 60_000;

const fatalConnectErrors = [
	'failed to collect probe metadata',
	'vpn detected',
];

class ErrorHandler {
	private lastErrorCode: WsApiError['info']['code'] | null = null;

	constructor (private readonly socket: Socket) {}

	connectError = (error: Error & {description?: {message: string}}) => {
		const message = error.description?.message ?? error.toString();
		logger.error(`Connection to API failed: ${message}`);

		const isFatalError = fatalConnectErrors.some(fatalError => error.message.startsWith(fatalError));

		if (isFatalError) {
			// At that stage socket.connected=false already,
			// but we want to stop reconnections for fatal errors
			this.socket.disconnect();
		}

		if (error.message.startsWith('invalid probe version')) {
			logger.debug('Detected an outdated probe. Restarting.');
			process.exit();
		}
	};

	handleApiError = (error: WsApiError): void => {
		this.lastErrorCode = error.info.code;

		if (error.info.probe) {
			const location = error.info.probe?.location;
			logger.debug(`Attempted to connect from ${location.city}, ${location.country}, ${location.continent} (${location.network}, ASN: ${location.asn}, lat: ${location.latitude} long: ${location.longitude}).`);
		}

		if (error.info.code === 'ip_limit') {
			logger.error(`Only 1 connection per IP address is allowed. Please make sure you don't have another probe running on IP ${error.info.probe?.ipAddress || ''}.`);
			logger.error('Retrying in 1 minute. Probe temporarily disconnected.');
		} else {
			logger.error('Probe validation error:', error);
		}
	};

	handleDisconnect = (reason: string): void => {
		logger.debug(`Disconnected from API: ${reason}.`);
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
