import os from 'node:os';
import _ from 'lodash';
import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('api:connect:alt-ips-token');

export const apiConnectAltIpsHandler = async ({ token }: { token: string }): Promise<void> => {
	const uniqIps = _(os.networkInterfaces())
		.values()
		.filter((int): int is os.NetworkInterfaceInfo[] => !!int)
		.flatten()
		.uniqBy('address')
		.filter(address => !address.internal)
		.map('address')
		.value();

	console.log('token', token);
	console.log('uniqIps', uniqIps);
};
