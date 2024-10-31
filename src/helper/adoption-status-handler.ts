import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('api:connect:adoption');

export const adoptionStatusHandler = async ({ isAdopted }: { isAdopted: boolean }): Promise<void> => {
	if (!isAdopted) {
		logger.info(`You can register this probe at https://dash.globalping.io to earn extra measurement credits.`);
	}
};
