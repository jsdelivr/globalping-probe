import os from 'node:os';
import config from 'config';
import _ from 'lodash';
import { scopedLogger } from '../lib/logger.js';
import got, { RequestError } from 'got';

const logger = scopedLogger('api:connect:alt-ips-token');

export const apiConnectAltIpsHandler = async ({ token, socketId, ip }: { token: string, socketId: string, ip: string }): Promise<void> => {
	const allIps = [ ip ];
	const addresses = _(os.networkInterfaces())
		.values()
		.filter((int): int is os.NetworkInterfaceInfo[] => !!int)
		.flatten()
		.uniqBy('address')
		.filter(address => !address.internal)
		.filter(address => !address.address.startsWith('fe80:'))
		.filter(address => !address.address.startsWith('169.254.'))
		.value();

	const results = await Promise.allSettled(addresses.map(({ address, family }) => sendToken(address, family === 'IPv6' ? 6 : 4, token, socketId)));

	results.forEach((result) => {
		if (result.status === 'rejected') {
			logger.error(result.reason instanceof RequestError ? result.reason.message : result);
		} else {
			allIps.push(result.value);
		}
	});

	const uniqIps = _(allIps).uniq().value();

	if (uniqIps.length === 1) {
		logger.info(`IP address of the probe: ${uniqIps[0]}`);
	} else {
		logger.info(`IP addresses of the probe: ${uniqIps.join(', ')}`);
	}
};

const sendToken = async (ip: string, dnsLookupIpVersion: 4 | 6, token: string, socketId: string) => {
	const httpHost = config.get<string>('api.httpHost');
	const response = await got.post<{ ip: string }>(`${httpHost}/alternative-ip`, {
		localAddress: ip,
		dnsLookupIpVersion,
		json: {
			token,
			socketId,
		},
		retry: {
			limit: 1,
			methods: [ 'POST' ],
			statusCodes: [ 504 ],
		},
		responseType: 'json',
	});

	return response.body.ip;
};
