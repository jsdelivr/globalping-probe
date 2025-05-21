import * as fs from 'node:fs';

const pkg: { version: string } = JSON.parse(fs.readFileSync('./package.json').toString()) as never;

export const VERSION = pkg.version;

export const PROGRESS_INTERVAL_TIME = 500;
