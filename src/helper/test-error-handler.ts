import { type Socket } from 'socket.io-client';
import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('test-error-handler');

export const handleTestError = (error: unknown, socket: Socket, measurementId: string, testId: string) => {
	logger.error('Failed to run the measurement:', error);

	const rawOutput = error instanceof Error ? error.message : String(error);

	socket.emit('probe:measurement:result', {
		testId,
		measurementId,
		result: {
			status: 'failed',
			rawOutput,
		},
	});
};
