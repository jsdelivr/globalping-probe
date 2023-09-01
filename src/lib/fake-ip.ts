// import { expand } from 'cidr-tools';

// let fakeIps: string[] = [];

// const initFakeIps = () => {
// 	const secondOctet = parseInt(process.env['FAKE_PROBE_IP']!, 10);
// 	fakeIps = expand(`100.${secondOctet}.0.0/20`);
// };

export const getFakeIp = () => {
	const octet1 = parseInt(process.env['FAKE_PROBE_IP']!, 10);
	const octet2 = Math.floor(process.pid / 65536) % 256; // Divide by 2^16
	const octet3 = Math.floor(process.pid / 256) % 256; // Divide by 2^8
	const octet4 = process.pid % 256;

	return `${octet1}.${octet2}.${octet3}.${octet4}`;
};

// if (process.env['FAKE_PROBE_IP']) {
// 	initFakeIps();
// }
