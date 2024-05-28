import dns from 'node:dns';
import { isIPv6 } from 'node:net';
import { isIpPrivate } from './private-ip.js';

export const getDnsServers = (getServers: () => string[] = dns.getServers): string[] => {
	const servers = getServers();

	return servers
		// Hide private ips
		.map((addr: string) => {
			let ip = addr.replace('[', '').replace(/]:\d{1,5}$/, ''); // removes port number if it is ipv6
			ip = isIPv6(ip) ? ip : ip.replace(/:\d{1,5}$/, ''); // removes port number if it is not ipv6
			return isIpPrivate(ip) ? 'private' : ip;
		});
};
