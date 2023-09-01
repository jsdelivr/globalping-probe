export const getFakeIp = () => {
	const octet1String = process.env['FAKE_PROBE_IP'];

	if (!octet1String) {
		throw new Error('FAKE_PROBE_IP is not specified');
	}

	const octet1 = parseInt(octet1String, 10);
	const octet2 = Math.floor(process.pid / 65536) % 256; // Divide by 2^16
	const octet3 = Math.floor(process.pid / 256) % 256; // Divide by 2^8
	const octet4 = process.pid % 256;

	return `${octet1}.${octet2}.${octet3}.${octet4}`;
};
