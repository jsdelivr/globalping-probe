import config from 'config';
import process from 'node:process';
import _ from 'lodash';
import got, { HTTPError, RequestError, TimeoutError } from 'got';
import { VERSION } from '../constants.js';
import { scopedLogger } from './logger.js';

type ReleaseInfo = {
	version: string;
};

const logger = scopedLogger('self-update');
const updateConfig = config.get<{releaseUrl: string; interval: number; maxDeviation: number}>('update');
const updateInterval = updateConfig.interval + _.random(0, updateConfig.maxDeviation);
let lastSuccessfulCheck = Date.now();

const checkForUpdates = () => {
	got(updateConfig.releaseUrl, { timeout: { request: 15_000 } }).json<ReleaseInfo>().then((releaseInfo) => {
		const latestVersion = releaseInfo.version.replace(/^v/, '');
		const isUpdateAvailable = latestVersion.localeCompare(VERSION, undefined, { numeric: true, sensitivity: 'base' }) > 0;
		lastSuccessfulCheck = Date.now();

		if (!isUpdateAvailable) {
			return;
		}

		logger.info(`New version ${latestVersion} of probe found. Starting self-update.`, {
			latestVersion,
			currentVersion: VERSION,
		});

		process.kill(process.pid, 'SIGTERM');
	}).catch((error: unknown) => {
		const oneHourAgo = Date.now() - 60 * 60 * 1000;

		if (lastSuccessfulCheck < oneHourAgo) {
			logger.warn('No successful update check in the last hour. Restarting the process.');
			process.kill(process.pid, 'SIGTERM');
			return;
		}

		if (error instanceof TimeoutError) {
			logger.warn('The request timed out while checking for a new probe version.');
			logger.warn(error);
			return;
		} else if (error instanceof HTTPError) {
			logger.warn('The request failed with an HTTP error while checking for a new probe version.');
			logger.warn(error);
			return;
		} else if (error instanceof RequestError) {
			logger.warn('The request failed while checking for a new probe version.');
			logger.warn(error);
			return;
		}

		throw error;
	});
};

if (process.env['NODE_ENV'] !== 'development') {
	setInterval(checkForUpdates, updateInterval * 1000);
}
