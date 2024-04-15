import { execSync } from 'node:child_process';
import os from 'node:os';

const WANTED_VERSION = 'v18.19.1';
const MIN_NODE_UPDATE_MEMORY = 1e9;

function update () {
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

update();
import('./probe.js');
