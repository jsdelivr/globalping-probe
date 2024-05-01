import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { isV1HardwareDevice } from './lib/util.js';

const WANTED_VERSION = 'v18.19.1';
const MIN_NODE_UPDATE_MEMORY = 1e9;
const dirname = path.dirname(fileURLToPath(import.meta.url));

function updateEntrypoint () {
	const currentEntrypointPath = path.join(dirname, '../../entrypoint.sh');
	const newEntrypointPath = path.join(dirname, '../bin/entrypoint.sh');

	if (!fs.existsSync(currentEntrypointPath) || !fs.existsSync(newEntrypointPath)) {
		return;
	}

	const currentEntrypoint = fs.readFileSync(currentEntrypointPath, 'utf8');
	const newEntrypoint = fs.readFileSync(newEntrypointPath, 'utf8');

	if (currentEntrypoint === newEntrypoint) {
		return;
	}

	// Changing the script while it's running might result in unexpected behavior
	// as bash continues reading the (changed) file from the original byte offset.
	// By replacing the file with just one command here, we cause the execution
	// to stop (the new file is shorter than the current offset), and we copy
	// the update after the restart (and then restart again for the same reason).
	console.log('Entrypoint change detected. Updating and restarting.');
	fs.writeFileSync(currentEntrypointPath, `cp ${newEntrypointPath} ${currentEntrypointPath} && exit\n`);
	process.exit(0);
}

function updateNode () {
	console.log(`[${new Date().toISOString()}] Current node.js version ${process.version}`);
	console.log(`[${new Date().toISOString()}] Wanted node.js version ${WANTED_VERSION}`);

	if (process.version === WANTED_VERSION) {
		return;
	}

	if (os.totalmem() < MIN_NODE_UPDATE_MEMORY) {
		console.log(`Total system memory ${os.totalmem()} below the required threshold. Not updating.`);

		if (isV1HardwareDevice() || process.env['GP_HOST_HW']) {
			logUpdateFirmwareMessage();
		} else {
			logUpdateContainerMessage();
		}

		return;
	}

	try {
		const NODE_MODULES_NVM = '/app/node_modules/nvm';
		const NVM_DIR = '/nvm';

		// Copy nvm outside of node_modules so that we don't delete it during the next self-update.
		execSync(`cp -r ${NODE_MODULES_NVM} /`);

		// Install the requested version.
		execSync(`\\. $NVM_DIR/nvm.sh && nvm install ${WANTED_VERSION} && nvm alias default ${WANTED_VERSION}`, { env: { NVM_DIR }, stdio: 'inherit' });

		// Symlink the new version to the default location to make the change permanent.
		const newNodePath = execSync(`\\. $NVM_DIR/nvm.sh && nvm which ${WANTED_VERSION}`, { env: { NVM_DIR } }).toString().trim();
		const oldNodePath = execSync('which node').toString().trim();

		console.log(`[${new Date().toISOString()}] Linking "${oldNodePath.trim()}" -> "${newNodePath}"`);
		execSync(`ln -sf "${newNodePath.trim()}" "${oldNodePath}"`);

		// Attempt to uninstall the previous version.
		try {
			execSync(`\\. $NVM_DIR/nvm.sh && nvm uninstall ${process.version} && nvm cache clear`, { env: { NVM_DIR }, stdio: 'inherit' });
		} catch (e) {
			console.error(`Failed to uninstall ${process.version}:`);
			console.error(e);
		}

		console.log(`[${new Date().toISOString()}] Restarting`);
		process.exit(0);
	} catch (e) {
		console.error(`Failed to update node.js:`);
		console.error(e);
	}
}

function logUpdateFirmwareMessage () {
	console.log(`
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@     WARNING: PROBE FIRMWARE OUTDATED, PLEASE UPDATE     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
Current probe firmware is out of date and we couldn't update it automatically.
Please update it manually using the guide from GitHub:
https://github.com/jsdelivr/globalping-hwprobe#download-the-latest-firmware
	`);

	setTimeout(logUpdateFirmwareMessage, 10 * 60 * 1000);
}

function logUpdateContainerMessage () {
	console.log(`
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@     WARNING: PROBE CONTAINER OUTDATED, PLEASE UPDATE    @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
Current probe container is out of date and we couldn't update it automatically.
Please either:
- update it manually: https://github.com/jsdelivr/globalping-probe#optional-container-update
- increase container RAM to >1GB
	`);

	setTimeout(logUpdateContainerMessage, 10 * 60 * 1000);
}

updateEntrypoint();
updateNode();
import('./probe.js');
