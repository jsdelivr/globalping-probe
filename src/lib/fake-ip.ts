// import { expand } from 'cidr-tools';

// let fakeIps: string[] = [];

const initFakeIps = () => {
	// const secondOctet = parseInt(process.env['FAKE_PROBE_IP']!, 10);
	// fakeIps = expand(`100.${secondOctet}.0.0/20`);
};

export const getFakeIp = () => {
	const secondOctet = parseInt(process.env['FAKE_PROBE_IP']!, 10);
	const thirdOctet = process.pid / 256 % 256;
	const forthOctet = process.pid % 256;

	return `100.${secondOctet}.${thirdOctet}.${forthOctet}`;
	// if (fakeIps.length === 0) {
	// 	throw new Error('Fake ips are not initialized.');
	// }

	// return fakeIps[process.pid % fakeIps.length];
};

if (process.env['FAKE_PROBE_IP']) {
	initFakeIps();
}
