import process from 'node:process';
import _ from 'lodash';
import {getConfValue} from './config.js';
import {scopedLogger} from './logger.js';

const logger = scopedLogger('health-restart');
const uptimeConfig = getConfValue<{interval: number; maxDeviation: number; maxUptime: number}>('uptime');
const uptimeInterval = uptimeConfig.interval + _.random(0, uptimeConfig.maxDeviation);

const checkUptime = () => {
	const uptime = process.uptime();

	if (uptime >= uptimeConfig.maxUptime) {
		logger.info('Scheduled Probe restart. Sending SIGTERM', {maxUptime: uptimeConfig.maxUptime});
		process.kill(process.pid, 'SIGTERM');
	}
};

setInterval(checkUptime, uptimeInterval * 1000);
