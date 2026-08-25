import path from 'node:path';
import * as td from 'testdouble';
import * as ip from '../../src/lib/ip.js';

await td.replaceEsm(path.resolve('src/lib/ip.ts'), {
	...ip,
	isIpPrivate: () => false,
	joiValidateIp: (value: string) => value,
});

export const mochaHooks = {
	beforeAll: () => {
		console.log('Prerequisite for non-root traceroute tests: sudo setcap cap_net_raw+ep "$(readlink -f "$(command -v traceroute)")"');
	},
	afterAll: () => td.reset(),
};
