import dns from 'node:dns';
import { isIPv6 } from 'node:net';
import { isIpPrivate } from './private-ip';

export const getDnsServers = (getServers: () => string[] = dns.getServers): string[] => {
	const servers = getServers();

	return servers
		// Filter out ipv6
		.filter((addr: string) => {
			const ipv6Match = /^\[(.*)]/g.exec(addr); // Nested with port
			return !isIPv6(addr) && !isIPv6(ipv6Match?.[1] ?? '');
		})
		// Hide private ips
		.map((addr: string) => {
			const ip = addr.replace(/:\d{1,5}$/, '');
			return isIpPrivate(ip) ? 'private' : addr;
		});
};
