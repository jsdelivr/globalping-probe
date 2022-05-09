import process from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import _ from 'lodash';

const readFile = (name: string): Record<string, unknown> => {
	const filePath = path.resolve(`./config/${name}.json`);

	if (!fs.existsSync(filePath)) {
		return {};
	}

	return JSON.parse(fs.readFileSync(filePath).toString()) as never;
};

const defaultConfig = readFile('default');
const envConfig = readFile(process.env['NODE_ENV'] ?? 'production');

const combined = _.merge(defaultConfig, envConfig);

export const getConfValue = <T>(path: string): T => _.get(combined, path) as T;
