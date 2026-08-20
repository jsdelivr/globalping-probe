import path from 'node:path';
import * as td from 'testdouble';
import * as ip from '../../src/lib/ip.js';

await td.replaceEsm(path.resolve('src/lib/ip.ts'), {
	...ip,
	isIpPrivate: () => false,
	joiValidateIp: (value: string) => value,
});

export const mochaHooks = {
	afterAll: () => td.reset(),
};
