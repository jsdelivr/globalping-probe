import process from 'node:process';
import _ from 'lodash';
import got, { TimeoutError } from 'got';
import { VERSION } from '../constants.js';
import { getConfValue } from './config.js';
import { scopedLogger } from './logger.js';

type ReleaseInfo = {
	tag_name: string;
};

const logger = scopedLogger('self-update');
const updateConfig = getConfValue<{releaseUrl: string; interval: number; maxDeviation: number}>('update');
const updateInterval = updateConfig.interval + _.random(0, updateConfig.maxDeviation);

const checkForUpdates = () => {
	got(updateConfig.releaseUrl, { timeout: { request: 15_000 } }).json<ReleaseInfo>().then((releaseInfo) => {
		const latestVersion = releaseInfo.tag_name.replace(/^v/, '');
		const isUpdateAvailable = latestVersion.localeCompare(VERSION, undefined, { numeric: true, sensitivity: 'base' }) > 0;

		if (!isUpdateAvailable) {
			return;
		}

		logger.info(`New version ${latestVersion} of Probe server found. Start self-update`, {
			latestVersion,
			currentVersion: VERSION,
		});

		process.kill(process.pid, 'SIGTERM');
	}).catch((error: unknown) => {
		if (error instanceof TimeoutError) {
			logger.warn('The server timed out, while checking for a new version.');
			logger.warn(error);
			return;
		}

		throw error;
	});
};

if (process.env['NODE_ENV'] !== 'development') {
	setInterval(checkForUpdates, updateInterval * 1000);
}
