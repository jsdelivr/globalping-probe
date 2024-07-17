import os from 'node:os';
import config from 'config';
import _ from 'lodash';
import { scopedLogger } from '../lib/logger.js';
import got, { type RequestError } from 'got';

const logger = scopedLogger('api:connect:alt-ips-token');

export const apiConnectAltIpsHandler = async ({ token, socketId }: { token: string, socketId: string }): Promise<void> => {
	const uniqIps = _(os.networkInterfaces())
		.values()
		.filter((int): int is os.NetworkInterfaceInfo[] => !!int)
		.flatten()
		.uniqBy('address')
		.filter(address => !address.internal)
		.map('address')
		.value();

	console.log('uniqIps', uniqIps);
	await Promise.all(uniqIps.map(ip => sendToken(ip, token, socketId)));
};

const sendToken = async (ip: string, token: string, socketId: string) => {
	try {
		await got.post(`${config.get<string>('api.httpHost')}/alternative-ip`, {
			localAddress: ip,
			json: {
				token,
				socketId,
			},
			retry: {
				limit: 1,
				methods: [ 'POST' ],
				statusCodes: [ 504 ],
			},
		});
	} catch (e) {
		logger.error((e as RequestError).message);
	}
};
