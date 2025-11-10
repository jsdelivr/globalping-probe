import type { Socket } from 'socket.io-client';
import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('api:error');

const probeErrors = [
	'ip limit',
	'vpn detected',
	'unresolvable geoip',
];

const apiErrors = [
	'failed to collect probe metadata',
];

class ErrorHandler {
	constructor (private readonly socket: Socket) {}

	connectError = (error: Error & {
		description?: { message: string };
		data?: { ipAddress?: string };
	}) => {
		const message = error?.description?.message ?? error.toString();

		if (message.includes('server is terminating')) {
			logger.debug('The server is terminating. Connecting to another one.');
		} else {
			logger.error(`Connection to API failed: ${message}`);
		}

		if (error.message.startsWith('invalid probe version')) {
			logger.info('Detected an outdated probe. Restarting.');
			process.exit();
		}

		this.socket.disconnect();

		const isProbeError = probeErrors.some(fatalError => error.message.startsWith(fatalError));
		const isApiError = apiErrors.some(apiError => error.message.startsWith(apiError));

		if (isProbeError) {
			if (error.message.startsWith('ip limit')) {
				logger.error(`Only 1 connection per IP address is allowed. Please make sure you don't have another probe running on IP ${error?.data?.ipAddress || ''}.`);
			}

			logger.error('Retrying in 1 hour. Probe temporarily disconnected.');
			setTimeout(() => this.socket.connect(), 60 * 60 * 1000);
		} else if (isApiError) {
			logger.error('Retrying in 1 minute. Probe temporarily disconnected.');
			setTimeout(() => this.socket.connect(), 60 * 1000);
		} else {
			setTimeout(() => this.socket.connect(), 2000);
		}
	};

	handleDisconnect = (reason: string): void => {
		logger.debug(`Disconnected from API: (${reason}).`);

		if (reason === 'io server disconnect') {
			setTimeout(() => this.socket.connect(), 2000);
		}
	};
}

export const initErrorHandler = (socket: Socket) => {
	const errorHandler = new ErrorHandler(socket);
	return errorHandler;
};
