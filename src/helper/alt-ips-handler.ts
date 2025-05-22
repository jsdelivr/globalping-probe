import os from 'node:os';
import config from 'config';
import _ from 'lodash';
import { scopedLogger } from '../lib/logger.js';
import got, { RequestError } from 'got';

const mainLogger = scopedLogger('general');
const altIpsLogger = scopedLogger('api:connect:alt-ips-handler');

export const apiConnectAltIpsHandler = async ({ token, socketId, ip }: { token: string; socketId: string; ip: string }): Promise<void> => {
	const acceptedIps = [ ip ];
	const rejectedIps: string[] = [];
	const addresses = _(os.networkInterfaces())
		.values()
		.filter((int): int is os.NetworkInterfaceInfo[] => !!int)
		.flatten()
		.uniqBy('address')
		.filter(address => !address.internal)
		.filter(address => !address.address.startsWith('fe80:')) // filter out link-local addresses
		.filter(address => !address.address.startsWith('169.254.')) // filter out link-local addresses
		.value();

	const results = await Promise.allSettled(addresses.map(({ address, family }) => sendToken(address, family === 'IPv6' ? 6 : 4, token, socketId)));

	results.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			acceptedIps.push(result.value);
		} else {
			if (!(result.reason instanceof RequestError)) {
				altIpsLogger.warn(result.reason);
			} else if (result.reason.response?.statusCode !== 400) {
				altIpsLogger.warn(`${result.reason.message} (via ${result.reason.options.localAddress}).`);
			} else {
				rejectedIps.push(addresses[index]!.address);
			}
		}
	});

	const uniqAcceptedIps = _(acceptedIps).uniq().value();
	const uniqRejectedIps = _(rejectedIps).uniq().value();

	if (uniqRejectedIps.length === 1) {
		altIpsLogger.info(`IP address rejected by the API: ${uniqRejectedIps.join(', ')}.`);
	} else if (uniqRejectedIps.length > 1) {
		altIpsLogger.info(`IP addresses rejected by the API: ${uniqRejectedIps.join(', ')}.`);
	}

	if (uniqAcceptedIps.length === 1) {
		mainLogger.info(`IP address of the probe: ${uniqAcceptedIps[0]}.`);
	} else {
		mainLogger.info(`IP addresses of the probe: ${uniqAcceptedIps.join(', ')}.`);
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
		timeout: {
			request: 10000,
		},
		responseType: 'json',
	});

	return response.body.ip;
};
