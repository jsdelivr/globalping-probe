import { expand } from 'cidr-tools';

let fakeIps: string[] = [];

const initFakeIps = () => {
	const secondDigit = parseInt(process.env['FAKE_PROBE_IP']!, 10);
	fakeIps = expand(`100.${secondDigit}.0.0/20`);
};

export const getFakeIp = () => {
	if (fakeIps.length === 0) {
		throw new Error('Fake ips are not initialized.');
	}

	return fakeIps[process.pid % fakeIps.length];
};

if (process.env['FAKE_PROBE_IP']) {
	initFakeIps();
}
