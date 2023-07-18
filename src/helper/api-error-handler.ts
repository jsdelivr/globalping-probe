import type { Socket } from 'socket.io-client';
import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('api:error');

const fatalConnectErrors = [
	'failed to collect probe metadata',
	'vpn detected',
	'unresolvable geoip',
];

class ErrorHandler {
	constructor (private readonly socket: Socket) {}

	connectError = (error: Error & {
		description?: {message: string}
		data?: {ipAddress?: string}
	}) => {
		const message = error?.description?.message ?? error.toString();
		logger.error(`Connection to API failed: ${message}`);


		if (error.message.startsWith('invalid probe version')) {
			logger.debug('Detected an outdated probe. Restarting.');
			process.exit();
		}

		this.socket.disconnect();

		const isFatalError = fatalConnectErrors.some(fatalError => error.message.startsWith(fatalError));

		if (isFatalError) {
			logger.error('Retrying in 1 hour. Probe temporarily disconnected.');
			setTimeout(() => this.socket.connect(), 60 * 60 * 1000);
		} else if (error.message.startsWith('ip limit')) {
			logger.error(`Only 1 connection per IP address is allowed. Please make sure you don't have another probe running on IP ${error?.data?.ipAddress || ''}.`);
			logger.error('Retrying in 1 minute. Probe temporarily disconnected.');
			setTimeout(() => this.socket.connect(), 60 * 1000);
		} else {
			setTimeout(() => this.socket.connect(), 1000);
		}
	};

	handleDisconnect = (reason: string): void => {
		logger.debug(`Disconnected from API: (${reason}).`);

		if (reason === 'io server disconnect') {
			this.socket.connect();
		}
	};
}

export const initErrorHandler = (socket: Socket) => {
	const errorHandler = new ErrorHandler(socket);
	return errorHandler;
};
