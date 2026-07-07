import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { getAvailableDiskSpace, looksLikeV1HardwareDevice } from './lib/util.js';

const WANTED_VERSION = 'v22.22.3';
const MIN_NODE_UPDATE_MEMORY = 250 * 1e6;
const MIN_NODE_UPDATE_DISK_SPACE_MB = 1000;
const dirname = path.dirname(fileURLToPath(import.meta.url));
const UUID_FILE = `/.globalping-probe-uuid`;

type ResourceStats = {
	memory: number;
	disk: number;
	hasMemory: boolean;
	hasDisk: boolean;
};

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

	// Editing the file in place would be unsafe if the script is still running (non-exec
	// legacy images): bash reads it lazily and would continue from the original byte
	// offset within the new content. Renaming a new file over it is safe - a running
	// bash keeps reading the old inode, and the new entrypoint takes effect at the
	// next container start. No restart is needed as the running app is already
	// up to date.
	console.log(`[${new Date().toISOString()}] Entrypoint change detected. Updating.`);

	try {
		const tmpPath = `${currentEntrypointPath}.tmp`;
		fs.writeFileSync(tmpPath, newEntrypoint);
		fs.chmodSync(tmpPath, fs.statSync(currentEntrypointPath).mode);
		fs.renameSync(tmpPath, currentEntrypointPath);
		console.log(`[${new Date().toISOString()}] Entrypoint updated. The new version will be used after the next restart.`);
	} catch (e) {
		console.error(`[${new Date().toISOString()}] Failed to update the entrypoint:`);
		console.error(e);
	}
}

function updateNode () {
	console.log(`[${new Date().toISOString()}] Current node.js version ${process.version}`);
	console.log(`[${new Date().toISOString()}] Wanted node.js version ${WANTED_VERSION}`);

	const isNodeUpToDate = process.version === WANTED_VERSION;
	const memory = Math.min(process.constrainedMemory?.() || Infinity, os.totalmem());
	const disk = getAvailableDiskSpace();
	const hasMemory = memory >= MIN_NODE_UPDATE_MEMORY;
	const hasDisk = disk >= MIN_NODE_UPDATE_DISK_SPACE_MB;
	const hasResources = hasMemory && hasDisk;
	const isHwProbe = process.env['GP_HOST_HW'] || looksLikeV1HardwareDevice();

	if (isNodeUpToDate) {
		!isHwProbe && !hasResources && logLowResourcesMessage({ memory, disk, hasMemory, hasDisk });
		return;
	}

	try {
		if (isHwProbe) {
			console.log(`[${new Date().toISOString()}] Hardware probe detected. Not updating.`);
			logUpdateFirmwareMessage();
			return;
		}

		// The install below ends with process.exit() to restart into the new node.js. On a
		// filesystem that doesn't persist across restarts the install would be undone on the
		// next boot and repeat forever. The UUID file, written on a previous boot, is the
		// persistence probe: if it's gone, don't attempt the update - just warn.
		if (!fs.existsSync(UUID_FILE)) {
			console.log(`[${new Date().toISOString()}] Ephemeral filesystem detected. Skipping the node.js update to avoid a restart loop.`);
			return;
		}

		if (!hasResources) {
			console.log(`[${new Date().toISOString()}] Insufficient resources for auto-update. Not updating.`);
			logUpdateContainerMessage({ memory, disk, hasMemory, hasDisk });
			return;
		}

		const NODE_MODULES_NVM = '/app/node_modules/nvm';
		const NVM_DIR = '/nvm';

		// Copy nvm outside of node_modules so that we don't delete it during the next self-update.
		execSync(`cp -r ${NODE_MODULES_NVM} /`);

		// Install the requested version.
		execSync(`\\. $NVM_DIR/nvm.sh && nvm install -b ${WANTED_VERSION} && nvm alias default ${WANTED_VERSION}`, { env: { NVM_DIR }, stdio: 'inherit' });

		// Symlink the new version to the default location to make the change permanent.
		const newNodePath = execSync(`\\. $NVM_DIR/nvm.sh && nvm which ${WANTED_VERSION}`, { env: { NVM_DIR } }).toString().trim();
		const oldNodePath = execSync('which node').toString().trim();

		console.log(`[${new Date().toISOString()}] Linking "${oldNodePath.trim()}" -> "${newNodePath}"`);
		execSync(`ln -sf "${newNodePath.trim()}" "${oldNodePath}"`);

		// Attempt to uninstall the previous version.
		try {
			execSync(`\\. $NVM_DIR/nvm.sh && nvm uninstall ${process.version} && nvm cache clear`, { env: { NVM_DIR }, stdio: 'inherit' });
		} catch (e) {
			console.error(`[${new Date().toISOString()}] Failed to uninstall ${process.version}:`);
			console.error(e);
		}

		console.log(`[${new Date().toISOString()}] Restarting`);
		process.exit(0);
	} catch (e) {
		console.error(`[${new Date().toISOString()}] Failed to update node.js:`);
		console.error(e);
	}
}

function setPersistentUUID () {
	// UUID already set; allows persistence on read-only systems with firmware support.
	if (process.env['GP_PROBE_UUID']) {
		return;
	}

	let probeUuid;

	try {
		probeUuid = fs.readFileSync(UUID_FILE, 'utf8').trim();
	} catch (e) {
		if (!fs.existsSync(UUID_FILE)) {
			console.log(`[${new Date().toISOString()}] No persistent UUID file. Generating a new one.`);
		} else {
			console.warn(`[${new Date().toISOString()}] Failed to read the persistent UUID. Generating a new one:`);
			console.warn(e);
		}

		probeUuid = randomUUID();

		try {
			fs.writeFileSync(UUID_FILE, probeUuid, 'utf8');
		} catch (e) {
			console.error(`[${new Date().toISOString()}] Failed to write the new UUID:`);
			console.error(e);
		}
	}

	process.env['GP_PROBE_UUID'] = probeUuid;
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

function getLines (stats: ResourceStats) {
	const lines = [];

	if (!stats.hasMemory) {
		lines.push(`  Memory: ${Math.round(stats.memory / 1e6)} MB is available to the probe. At least ${MIN_NODE_UPDATE_MEMORY / 1e6} MB is required.`);
	}

	if (!stats.hasDisk) {
		lines.push(`  Disk: ${stats.disk} MB is available. At least ${MIN_NODE_UPDATE_DISK_SPACE_MB} MB is required.`);
	}

	return lines.join('\n');
}

function getResourceIncreaseText (stats: ResourceStats) {
	return [
		!stats.hasMemory && `RAM to at least ${(MIN_NODE_UPDATE_MEMORY / 1e6) * 2} MB`,
		!stats.hasDisk && `disk space to at least ${MIN_NODE_UPDATE_DISK_SPACE_MB} MB`,
	].filter(Boolean).join(' and ');
}

function logLowResourcesMessage (stats: ResourceStats) {
	console.log(`
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@      WARNING: LOW RESOURCES, AUTO-UPDATES DISABLED      @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
This probe does not meet the minimum resource requirements for automatic updates.
It may stop working after a new version is released.
${getLines(stats)}
Please increase ${getResourceIncreaseText(stats)}.
	`);

	setTimeout(() => logLowResourcesMessage(stats), 10 * 60 * 1000);
}

function logUpdateContainerMessage (stats: ResourceStats) {
	console.log(`
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@     WARNING: PROBE CONTAINER OUTDATED, PLEASE UPDATE    @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
The current probe container is out of date, and it could not be updated automatically.
${getLines(stats)}
Please either:
- update it manually: https://github.com/jsdelivr/globalping-probe#optional-container-update
- increase ${getResourceIncreaseText(stats)}
	`);

	setTimeout(() => logUpdateContainerMessage(stats), 10 * 60 * 1000);
}

updateEntrypoint();
updateNode();

setPersistentUUID();
void import('./probe.js');
