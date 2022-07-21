import dns from 'node:dns';
import validator from 'validator';
import isIpPrivate from 'private-ip';

export const getDnsServers = (getServers: () => string[] = dns.getServers): string[] => {
	const servers = getServers();

	return servers
	// Filter out ipv6
		.filter((addr: string) => {
			const ipv6Match = /^\[(.*)]/g.exec(addr); // Nested with port
			return !(validator.isIP(addr, 6) || validator.isIP(ipv6Match?.[1] ?? ''));
		})
	// Hide private ips
		.map((addr: string) => {
			const ip = addr.replace(/:\d{1,5}$/, '');
			return isIpPrivate(ip) ? 'local' : addr;
		});
};
