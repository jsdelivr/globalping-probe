import {scopedLogger} from '../lib/logger.js';
import type {ProbeLocation} from '../types.js';

const logger = scopedLogger('api:connect');

export const apiConnectLocationHandler = (data: ProbeLocation): void => {
	logger.info(`connected from (${data.city}, ${data.country}, ${data.continent}) (lat: ${data.latitude} long: ${data.longitude})`);
};
