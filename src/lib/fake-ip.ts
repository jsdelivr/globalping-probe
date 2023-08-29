import { getIPRange } from 'get-ip-range';

let fakeIps: string[] = [];

const initFakeIps = () => {
	const firstDigit = parseInt(process.env['FAKE_IP']!, 10);
	fakeIps = getIPRange(`${firstDigit}.0.0.0/20`);
};

export const getFakeIp = () => {
	if (fakeIps.length === 0) {
		throw new Error('Fake ips are not initialized.');
	}

	return fakeIps[process.pid % fakeIps.length];
};

if (process.env['FAKE_IP']) {
	initFakeIps();
}
