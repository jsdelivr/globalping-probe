import process from 'node:process';
import _ from 'lodash';
import got from 'got';
import {VERSION} from '../constants.js';
import {getConfValue} from './config.js';
import {scopedLogger} from './logger.js';

type ReleaseInfo = {
	tag_name: string;
};

const logger = scopedLogger('self-update');
const updateConfig = getConfValue<{releaseUrl: string; interval: number; maxDeviation: number}>('update');
const updateInterval = updateConfig.interval + _.random(0, updateConfig.maxDeviation);

const checkForUpdates = async () => {
	const releaseInfo = await got(updateConfig.releaseUrl, {timeout: {request: 15_000}}).json<ReleaseInfo>();
	const latestVersion = releaseInfo.tag_name.replace(/^v/, '');

	if (latestVersion === VERSION) {
		return;
	}

	logger.info(`New version ${latestVersion} of Probe server found. Start self-update`, {
		latestVersion,
		currentVersion: VERSION,
	});

	/* eslint-disable-next-line unicorn/no-process-exit */
	process.exit();
};

setInterval(checkForUpdates, updateInterval * 1000);
