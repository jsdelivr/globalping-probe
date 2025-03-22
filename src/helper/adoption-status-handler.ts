import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('api:connect:adoption');

export const adoptionStatusHandler = async ({ message, level }: { message: string, level?: 'info' | 'warn' | 'error' }): Promise<void> => {
	logger[level || 'info'](message);
};
