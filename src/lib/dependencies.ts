import path, {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execa} from 'execa';

const appDir = path.join(dirname(fileURLToPath(import.meta.url)), '..');

export const loadAll = async () => {
	await loadUnbuffer();
};

export const loadUnbuffer = async () => {
	await execa(path.join(appDir, 'sh', 'unbuffer.sh'));
};

export const hasRequired = async () => isUnbufferAvailable();

export const isUnbufferAvailable = async () => {
	try {
		await execa('which', ['unbuffer']);
		return true;
	} catch {
		return false;
	}
};
