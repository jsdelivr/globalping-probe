import dns from 'node:dns';
import { isIP, isIPv6 } from 'node:net';
import { isIpPrivate } from './private-ip';

export const getDnsServers = (getServers: () => string[] = dns.getServers): string[] => {
	const servers = getServers();

	return servers
	// Filter out ipv6
		.filter((addr: string) => {
			if (isIPv6(addr)) {
				return false;
			}

			const ipv6Match = /^\[(.*)]/g.exec(addr); // Nested with port

			if (ipv6Match && ipv6Match[1]) {
				return !isIP(ipv6Match[1]);
			}

			return true;
		})
	// Hide private ips
		.map((addr: string) => {
			const ip = addr.replace(/:\d{1,5}$/, '');
			return isIpPrivate(ip) ? 'private' : addr;
		});
};
