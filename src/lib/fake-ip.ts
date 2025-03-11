export const getFakeIp = (workerId: number = 0) => {
	const first3Octets = process.env['FAKE_IP_FIRST_3_OCTETS']!;

	const octet4 = workerId % 256;

	return `${first3Octets}.${octet4}`;
};
