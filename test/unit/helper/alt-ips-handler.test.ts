import * as td from 'testdouble';
import sinon from 'sinon';
import nock from 'nock';
import { expect } from 'chai';

import type { apiConnectAltIpsHandler as apiConnectAltIpsHandlerSrc } from '../../../src/helper/alt-ips-handler.js';

describe('apiConnectAltIpsHandler', async () => {
	const networkInterfaces = sinon.stub();
	let apiConnectAltIpsHandler: typeof apiConnectAltIpsHandlerSrc;

	before(async () => {
		await td.replaceEsm('node:os', {}, {
			networkInterfaces,
		});

		({ apiConnectAltIpsHandler } = await import('../../../src/helper/alt-ips-handler.js'));
	});

	beforeEach(() => {
		networkInterfaces.returns({
			lo: [
				{
					address: '127.0.0.1',
					netmask: '255.0.0.0',
					family: 'IPv4',
					mac: '00:00:00:00:00:00',
					internal: true,
					cidr: '127.0.0.1/8',
				},
				{
					address: '::1',
					netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
					family: 'IPv6',
					mac: '00:00:00:00:00:00',
					internal: true,
					cidr: '::1/128',
					scopeid: 0,
				},
			],
			ens5: [
				{
					address: '1.0.1.0',
					netmask: '255.255.240.0',
					family: 'IPv4',
					mac: '0a:ab:82:5a:50:d1',
					internal: false,
					cidr: '172.31.43.80/20',
				},
				{
					address: '172.31.43.80',
					netmask: '255.255.240.0',
					family: 'IPv4',
					mac: '0a:ab:82:5a:50:d1',
					internal: false,
					cidr: '172.31.43.80/20',
				},
				{
					address: '172.31.43.80',
					netmask: '255.255.240.0',
					family: 'IPv4',
					mac: '0a:ab:82:5a:50:d1',
					internal: false,
					cidr: '172.31.43.80/20',
				},
				{
					address: '2a05:d016:174:7b28:f47b:e6:3307:fab6',
					netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
					family: 'IPv6',
					mac: '0a:ab:82:5a:50:d1',
					internal: false,
					cidr: '2a05:d016:174:7b28:f47b:e6:3307:fab6/128',
					scopeid: 0,
				},
				{
					address: 'fe80::8ab:82ff:fe5a:50d1',
					netmask: 'ffff:ffff:ffff:ffff::',
					family: 'IPv6',
					mac: '0a:ab:82:5a:50:d1',
					internal: false,
					cidr: 'fe80::8ab:82ff:fe5a:50d1/64',
					scopeid: 2,
				},
			],
		});
	});

	afterEach(() => {
		nock.cleanAll();
	});

	after(() => {
		td.reset();
	});

	it('should send alt ip request through valid addresses', async () => {
		const reqs = [];
		const nockRequest = nock('https://api.globalping.io/v1').persist()
			.post('/alternative-ip', (body) => {
				expect(body).to.deep.equal({ token: 'token', socketId: 'socketId' });
				return true;
			}).reply(200, function () {
				reqs.push(this.req);
			});

		await apiConnectAltIpsHandler({
			token: 'token',
			socketId: 'socketId',
			ip: '3.3.3.3',
		});

		expect(reqs.length).to.equal(2);
		expect(reqs[0].options.localAddress).to.equal('1.0.1.0');
		expect(reqs[1].options.localAddress).to.equal('2a05:d016:174:7b28:f47b:e6:3307:fab6');
		expect(nockRequest.isDone()).to.equal(true);
	});
});
