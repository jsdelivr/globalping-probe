import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('api:connect:adoption');

export const adoptionStatusHandler = async ({ message }: { message: string }): Promise<void> => {
	logger.info(message);
};
