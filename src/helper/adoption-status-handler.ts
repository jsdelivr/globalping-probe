import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('api:connect:adoption');

export const adoptionStatusHandler = async ({ isAdopted }: { isAdopted: boolean }): Promise<void> => {
	if (!isAdopted) {
		logger.info(`This probe can be registered at https://dash.globalping.io to earn measurement credits for you.`);
	}
};
