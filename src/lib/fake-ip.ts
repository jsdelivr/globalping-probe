export const getFakeIp = (workerId: number = 0) => {
	const firstOctets = process.env['FAKE_IP_FIRST_OCTETS']!;
	const octests = firstOctets.split('.');

	const octet1 = octests[0] || (workerId % 256);
	const octet2 = octests[1] || (workerId % 256);
	const octet3 = octests[2] || (workerId % 256);
	const octet4 = octests[3] || (workerId % 256);

	return `${octet1}.${octet2}.${octet3}.${octet4}`;
};
