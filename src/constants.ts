import * as fs from 'node:fs';

const pkg: {version: string} = JSON.parse(fs.readFileSync('./package.json').toString()) as never;

/* eslint-disable-next-line @typescript-eslint/naming-convention */
export const VERSION = pkg.version;
