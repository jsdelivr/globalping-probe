import { expect } from 'chai';
import * as sinon from 'sinon';
import dns from 'node:dns';
import { getDnsServers, dnsLookup, cachedDnsLookup, clearDnsCache } from '../../../src/lib/dns.js';
import { callbackify } from '../../../src/lib/util.js';

const client = (list: string[]) => () => list;

describe('dns lib', () => {
	describe('ipv6', () => {
		it('should not filter out ipv6', () => {
			const input = [
				'1.1.1.1',
				'2001:4860:4860::8888',
			];

			const servers = getDnsServers(client(input));

			expect(servers.length).to.equal(2);

			expect(servers).to.deep.equal([
				'1.1.1.1',
				'2001:4860:4860::8888',
			]);
		});

		it('should not filter out ipv6 (with port)', () => {
			const input = [
				'1.1.1.1',
				'[2001:4860:4860::8888]:53',
			];

			const servers = getDnsServers(client(input));

			expect(servers.length).to.equal(2);

			expect(servers).to.deep.equal([
				'1.1.1.1',
				'2001:4860:4860::8888',
			]);
		});
	});

	describe('private ip', () => {
		it('should mask private ipv4', () => {
			const input = [
				'192.168.0.53',
				'1.1.1.1',
			];

			const servers = getDnsServers(client(input));

			expect(servers.length).to.equal(2);

			expect(servers).to.deep.equal([
				'private',
				'1.1.1.1',
			]);
		});

		it('should mask private ipv6', () => {
			const input = [
				'2001:db8:fa34::',
				'1.1.1.1',
			];

			const servers = getDnsServers(client(input));

			expect(servers.length).to.equal(2);

			expect(servers).to.deep.equal([
				'private',
				'1.1.1.1',
			]);
		});

		it('should mask private ipv4 with port', () => {
			const input = [
				'192.168.0.53:53',
				'1.1.1.1',
			];

			const servers = getDnsServers(client(input));

			expect(servers.length).to.equal(2);

			expect(servers).to.deep.equal([
				'private',
				'1.1.1.1',
			]);
		});

		it('should mask private ipv6 with port', () => {
			const input = [
				'[2001:db8:fa34::]:53',
				'1.1.1.1',
			];

			const servers = getDnsServers(client(input));

			expect(servers.length).to.equal(2);

			expect(servers).to.deep.equal([
				'private',
				'1.1.1.1',
			]);
		});
	});
});

describe('dnsLookup / cachedDnsLookup', () => {
	const sandbox = sinon.createSandbox();
	let resolve4: sinon.SinonStub;

	beforeEach(() => {
		clearDnsCache();
		resolve4 = sandbox.stub(dns.promises.Resolver.prototype, 'resolve4').resolves([{ address: '1.1.1.1', ttl: 300 }]);
	});

	afterEach(() => sandbox.restore());

	it('returns the first public address with its family', async () => {
		expect(await dnsLookup('example.com', { family: 4 })).to.deep.equal([ '1.1.1.1', 4 ]);
	});

	it('skips private addresses', async () => {
		resolve4.resolves([{ address: '192.168.0.1', ttl: 300 }, { address: '1.1.1.1', ttl: 300 }]);

		expect(await dnsLookup('example.com', { family: 4 })).to.deep.equal([ '1.1.1.1', 4 ]);
	});

	it('throws when all addresses are private', async () => {
		resolve4.resolves([{ address: '192.168.0.1', ttl: 300 }]);

		let threw;

		try {
			await dnsLookup('example.com', { family: 4 });
		} catch (error) {
			threw = error as Error;
		}

		expect(threw?.message).to.equal('Private IP ranges are not allowed.');
	});

	it('cachedDnsLookup resolves once per key, dnsLookup every time', async () => {
		await cachedDnsLookup('example.com', { family: 4 });
		await cachedDnsLookup('example.com', { family: 4 });
		expect(resolve4.callCount).to.equal(1);

		await dnsLookup('example.com', { family: 4 });
		await dnsLookup('example.com', { family: 4 });
		expect(resolve4.callCount).to.equal(3);
	});

	it('expires the cache entry once the record ttl elapses', async () => {
		resolve4.resolves([{ address: '1.1.1.1', ttl: 0 }]);

		await cachedDnsLookup('example.com', { family: 4 });
		await new Promise(resolve => setTimeout(resolve, 10));
		await cachedDnsLookup('example.com', { family: 4 });

		expect(resolve4.callCount).to.equal(2);
	});

	it('does not cache failures', async () => {
		resolve4.onFirstCall().rejects(new Error('ENOTFOUND'));
		resolve4.onSecondCall().resolves([{ address: '1.1.1.1', ttl: 300 }]);

		let threw = false;

		try {
			await cachedDnsLookup('example.com', { family: 4 });
		} catch {
			threw = true;
		}

		expect(threw).to.be.true;
		expect(await cachedDnsLookup('example.com', { family: 4 })).to.deep.equal([ '1.1.1.1', 4 ]);
		expect(resolve4.callCount).to.equal(2);
	});

	it('dedupes concurrent in-flight lookups', async () => {
		await Promise.all([
			cachedDnsLookup('example.com', { family: 4 }),
			cachedDnsLookup('example.com', { family: 4 }),
		]);

		expect(resolve4.callCount).to.equal(1);
	});

	it('resolves IPv6 via resolve6', async () => {
		const resolve6 = sandbox.stub(dns.promises.Resolver.prototype, 'resolve6').resolves([{ address: '2606:4700:4700::1111', ttl: 300 }]);

		expect(await dnsLookup('example.com', { family: 6 })).to.deep.equal([ '2606:4700:4700::1111', 6 ]);
		expect(resolve6.callCount).to.equal(1);
	});

	it('returns joined TXT records without filtering', async () => {
		const resolveTxt = sandbox.stub(dns.promises.Resolver.prototype, 'resolveTxt').resolves([ [ 'AS123', ' | abc' ], [ 'AS456' ] ]);

		expect(await cachedDnsLookup('example.com', { rrtype: 'TXT' })).to.deep.equal([ 'AS123 | abc', 'AS456' ]);
		expect(resolveTxt.callCount).to.equal(1);
	});
});

describe('callbackify', () => {
	it('calls back with the resolved value', (done) => {
		callbackify(async () => '1.1.1.1')('example.com', (error: Error | null, result: unknown) => {
			expect(error).to.equal(null);
			expect(result).to.equal('1.1.1.1');
			done();
		});
	});

	it('spreads an array result when spreadResult is true', (done) => {
		callbackify(async () => [ '1.1.1.1', 4 ], true)('example.com', (error: Error | null, address: unknown, family: unknown) => {
			expect(error).to.equal(null);
			expect(address).to.equal('1.1.1.1');
			expect(family).to.equal(4);
			done();
		});
	});

	it('calls back with the error on rejection', (done) => {
		const err = new Error('boom');

		callbackify(async () => {
			throw err;
		})('example.com', (error: Error | null) => {
			expect(error).to.equal(err);
			done();
		});
	});
});
