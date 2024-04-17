import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
		return;
	}

	try {
		execSync(`\\. $NVM_DIR/nvm.sh && nvm install ${WANTED_VERSION}`, { env: { NVM_DIR: '/app/node_modules/nvm' }, stdio: 'inherit' });

		const newNodePath = execSync(`\\. $NVM_DIR/nvm.sh && nvm which ${WANTED_VERSION}`, { env: { NVM_DIR: '/app/node_modules/nvm' } }).toString().trim();
		const oldNodePath = execSync('which node').toString().trim();

		console.log(`[${new Date().toISOString()}] Linking "${oldNodePath.trim()}" -> "${newNodePath}"`);
		execSync(`ln -sf "${newNodePath.trim()}" "${oldNodePath}"`);

		console.log(`[${new Date().toISOString()}] Restarting`);
		process.exit(0);
	} catch (e) {
		console.error(`Failed to update node.js:`);
		console.error(e);
	}
}

updateEntrypoint();
updateNode();
import('./probe.js');
