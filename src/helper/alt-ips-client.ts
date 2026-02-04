import config from 'config';
import _ from 'lodash';
import { scopedLogger } from '../lib/logger.js';
import got, { RequestError } from 'got';
import type { Socket } from 'socket.io-client';
import { pluralize } from '../lib/util.js';
import { getLocalIps } from '../lib/private-ip.js';

const mainLogger = scopedLogger('general');
const altIpsLogger = scopedLogger('api:connect:alt-ips-handler');

export class AltIpsClient {
	private readonly INTERVAL_TIME = 10 * 60 * 1000;
	private timer?: NodeJS.Timeout;
	private socket: Socket;
	private ip: string;
	private currentIps: string[] = [];
	private currentRejectedIps: Record<string, string> = {};
	private currentFailedIps: Record<string, string> = {};

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
		const addresses = getLocalIps();

		const results = await Promise.allSettled(addresses.map(({ address, family }) => {
			return this.getAltIpToken(address, family === 'IPv6' ? 6 : 4);
		}));

		const ipsToTokens: [string, string][] = [];
		const failedIps: Record<string, string> = {};
		let rejectedIps: Record<string, string> = {};

		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				ipsToTokens.push([ result.value.ip, result.value.token ]);
			} else {
				if (!(result.reason instanceof RequestError)) {
					altIpsLogger.warn(result.reason);
				} else if (result.reason.response?.statusCode !== 400) {
					failedIps[result.reason.options.localAddress!] = result.reason.message;
				} else {
					rejectedIps[addresses[index]!.address] = result.reason.message;
				}
			}
		});

		this.socket.emit('probe:alt-ips', ipsToTokens, ({ addedAltIps, rejectedIpsToReasons }: { addedAltIps: string[]; rejectedIpsToReasons: Record<string, string> }) => {
			const uniqAcceptedIps = _.uniq([ this.ip, ...addedAltIps.sort() ]);
			rejectedIps = { ...rejectedIps, ...rejectedIpsToReasons };

			uniqAcceptedIps.forEach((ip) => {
				delete rejectedIps[ip];
				delete failedIps[ip];
			});

			const ipsChanged = !_.isEqual(uniqAcceptedIps, this.currentIps) || !_.isEqual(rejectedIps, this.currentRejectedIps) || !_.isEqual(failedIps, this.currentFailedIps);

			this.currentIps = uniqAcceptedIps;
			this.currentRejectedIps = rejectedIps;
			this.currentFailedIps = failedIps;

			if (ipsChanged) {
				Object.entries(this.currentFailedIps).forEach(([ ip, error ]) => altIpsLogger.warn(`${error} (via ${ip}).`));
				Object.entries(this.currentRejectedIps).forEach(([ ip, reason ]) => altIpsLogger.warn(`IP ${ip} rejected: ${reason}`));
				mainLogger.info(`${pluralize('IP address', 'IP addresses', uniqAcceptedIps.length)} of the probe: ${uniqAcceptedIps.join(', ')}.`);
			}
		});
	}

	private async getAltIpToken (ip: string, dnsLookupIpVersion: 4 | 6) {
		const httpHost = config.get<string>('api.httpHost');
		const response = await got.post<{ ip: string; token: string }>(`${httpHost}/alternative-ip`, {
			localAddress: ip,
			dnsLookupIpVersion,
			json: {
				localAddress: ip,
			},
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
