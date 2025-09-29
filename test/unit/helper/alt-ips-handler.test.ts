import * as td from 'testdouble';
import sinon from 'sinon';
import nock from 'nock';
import { expect } from 'chai';
import type { Socket } from 'socket.io-client';

import type { AltIpsClient as AltIpsClientType } from '../../../src/helper/alt-ips-client.js';

describe('apiConnectAltIpsHandler', async () => {
	const networkInterfaces = sinon.stub();
	let AltIpsClient: typeof AltIpsClientType;

	before(async () => {
		await td.replaceEsm('node:os', {}, {
			networkInterfaces,
		});

		({ AltIpsClient } = await import('../../../src/helper/alt-ips-client.js'));
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

		nock('https://api.globalping.io/v1')
			.post('/alternative-ip').reply(200, function () {
				reqs.push(this.req);
				return { ip: '2.2.2.2', token: 'token-2.2.2.2' };
			});

		nock('https://api.globalping.io/v1')
			.post('/alternative-ip').reply(200, function () {
				reqs.push(this.req);
				return { ip: '3.3.3.3', token: 'token-3.3.3.3' };
			});

		nock('https://api.globalping.io/v1')
			.post('/alternative-ip').reply(200, function () {
				reqs.push(this.req);
				return { ip: '44::44:44', token: 'token-44::44:44' };
			});

		const emit = sinon.stub();
		const altIpsClient = new AltIpsClient({ emit } as unknown as Socket, '1.1.1.1');
		await altIpsClient.refreshAltIps();

		expect(reqs.length).to.equal(3);
		expect(reqs[0].options.localAddress).to.equal('1.0.1.0');
		expect(reqs[1].options.localAddress).to.equal('172.31.43.80');
		expect(reqs[2].options.localAddress).to.equal('2a05:d016:174:7b28:f47b:e6:3307:fab6');
		expect(emit.callCount).to.equal(1);
		expect(emit.firstCall.args[0]).to.equal('probe:alt-ips');

		expect(emit.firstCall.args[1]).to.deep.equal([
			[ '2.2.2.2', 'token-2.2.2.2' ],
			[ '3.3.3.3', 'token-3.3.3.3' ],
			[ '44::44:44', 'token-44::44:44' ],
		]);

		expect(nock.isDone()).to.equal(true);
	});
});
