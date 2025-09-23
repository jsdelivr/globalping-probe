import os from 'node:os';
import config from 'config';
import is from '@sindresorhus/is';
import _ from 'lodash';
import { scopedLogger } from '../lib/logger.js';
import got, { RequestError } from 'got';
import type { Socket } from 'socket.io-client';
import { pluralize } from '../lib/util.js';

const mainLogger = scopedLogger('general');
const altIpsLogger = scopedLogger('api:connect:alt-ips-handler');

class AltIpsClient {
	private readonly INTERVAL_TIME = 10 * 60 * 1000;

	socket: Socket;
	ip: string;
	private timer?: NodeJS.Timeout;

	constructor (socket: Socket, ip: string) {
		this.socket = socket;
		this.ip = ip;
		this.start();
	}

	updateConfig (socket: Socket, ip: string) {
		this.socket = socket;
		this.ip = ip;
		this.start();
	}

	start () {
		clearTimeout(this.timer);
		this.run();
	}

	private run () {
		void this.refreshAltIps().catch((error) => {
			altIpsLogger.error(error);
		}).finally(() => {
			this.timer = setTimeout(() => this.run(), this.INTERVAL_TIME);
		});
	}


	private async refreshAltIps (): Promise<void> {
		const rejectedIps: string[] = [];
		const addresses = _(os.networkInterfaces())
			.values()
			.filter(is.truthy)
			.flatten()
			.uniqBy('address')
			.filter(address => !address.internal)
			.filter(address => !address.address.startsWith('fe80:')) // filter out link-local addresses
			.filter(address => !address.address.startsWith('169.254.')) // filter out link-local addresses
			.value();

		const results = await Promise.allSettled(addresses.map(({ address, family }) => this.getAltIpToken(address, family === 'IPv6' ? 6 : 4)));
		const ipsToTokens: Record<string, string> = {};

		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				ipsToTokens[result.value.ip] = result.value.token;
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

		this.socket.emit('probe:alt-ips', ipsToTokens, (addedAltIps: string[]) => {
			const uniqAcceptedIps = [ this.ip, ...addedAltIps ];
			const uniqRejectedIps = _(rejectedIps).uniq().value();

			if (uniqRejectedIps.length > 0) {
				altIpsLogger.info(`IP ${pluralize('address', 'addresses', uniqRejectedIps.length)} rejected by the API: ${uniqRejectedIps.join(', ')}.`);
			}

			if (uniqAcceptedIps.length > 0) {
				mainLogger.info(`IP ${pluralize('address', 'addresses', uniqAcceptedIps.length)} of the probe: ${uniqAcceptedIps.join(', ')}.`);
			}
		});
	}

	private async getAltIpToken (ip: string, dnsLookupIpVersion: 4 | 6) {
		const httpHost = config.get<string>('api.httpHost');
		const response = await got.post<{ ip: string; token: string }>(`${httpHost}/alternative-ip`, {
			localAddress: ip,
			dnsLookupIpVersion,
			retry: {
				limit: 2,
				methods: [ 'POST' ],
				statusCodes: [ 504 ],
			},
			timeout: {
				request: 15_000,
			},
			responseType: 'json',
		});

		return response.body;
	}
}

let altIpsClient: AltIpsClient | null = null;

export const ipHandler = (socket: Socket) => ({ ip }: { ip: string }) => {
	if (!altIpsClient) {
		altIpsClient = new AltIpsClient(socket, ip);
	} else {
		altIpsClient.updateConfig(socket, ip);
	}
};
