import dns from 'node:dns';
import { isIpPrivate } from './private-ip.js';
import { isIPv6 } from 'node:net';

export const getDnsServers = (getServers: () => string[] = dns.getServers): string[] => {
	const servers = getServers();

	return servers
		// Hide private ips
		.map((addr: string) => {
			const ip_ = addr.replace('[', '').replace(/]:\d{1,5}$/, ''); // removes port number if it is ipv6
			const ip = isIPv6(ip_) ? ip_ : ip_.replace(/:\d{1,5}$/, ''); // removes port number if it is not ipv6
			return isIpPrivate(ip) ? 'private' : addr;
		});
};
