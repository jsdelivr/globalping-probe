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

export class AltIpsClient {
	private readonly INTERVAL_TIME = 10 * 60 * 1000;
	private timer?: NodeJS.Timeout;
	private socket: Socket;
	private ip: string;
	private currentIps: string[] = [];
	private currentRejectedIps: string[] = [];

	constructor (socket: Socket, ip: string) {
		this.socket = socket;
		this.ip = ip;
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


	async refreshAltIps (): Promise<void> {
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

		const ipsToTokens: [string, string][] = [];
		const rejectedLocalIpsToReasons: Record<string, string> = {};
		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				ipsToTokens.push([ result.value.ip, result.value.token ]);
			} else {
				if (result.reason instanceof RequestError) {
					rejectedLocalIpsToReasons[`${addresses[index]!.address} (local)`] = result.reason.message;
				} else {
					rejectedLocalIpsToReasons[`${addresses[index]!.address} (local)`] = (result.reason as Error).toString();
				}
			}
		});

		this.socket.emit('probe:alt-ips', ipsToTokens, ({ addedAltIps, rejectedIpsToReasons }: { addedAltIps: string[]; rejectedIpsToReasons: Record<string, string> }) => {
			const uniqAcceptedIps = [ this.ip, ...addedAltIps.sort() ];
			const rejectedIps = { ...rejectedLocalIpsToReasons, ...rejectedIpsToReasons };
			uniqAcceptedIps.forEach(ip => delete rejectedIps[ip]);
			const uniqRejectedIps = Object.keys(rejectedIps).sort();
			const ipsChanged = !_.isEqual(uniqAcceptedIps, this.currentIps) || !_.isEqual(uniqRejectedIps, this.currentRejectedIps);
			this.currentIps = uniqAcceptedIps;
			this.currentRejectedIps = uniqRejectedIps;

			if (!_.isEmpty(rejectedIps) && ipsChanged) {
				altIpsLogger.warn(`${pluralize('IP', 'IPs', Object.keys(rejectedIps).length)} rejected by the API: 
${Object.entries(rejectedIps).map(([ ip, error ]) => `${ip}: ${error}`).join('\n')}`);
			}

			if (uniqAcceptedIps.length > 0 && ipsChanged) {
				mainLogger.info(`${pluralize('IP', 'IPs', uniqAcceptedIps.length)} of the probe: ${uniqAcceptedIps.join(', ')}.`);
			}
		});
	}

	private async getAltIpToken (ip: string, dnsLookupIpVersion: 4 | 6) {
		const httpHost = config.get<string>('api.httpHost');
		const response = await got.post<{ ip: string; token: string }>(`${httpHost}/alternative-ip`, {
			localAddress: ip,
			dnsLookupIpVersion,
			retry: {
				limit: 1,
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
		altIpsClient.start();
	} else {
		altIpsClient.updateConfig(socket, ip);
	}
};
