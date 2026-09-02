import { expect } from 'chai';
import * as sinon from 'sinon';
import dns from 'node:dns';
import { performance } from 'node:perf_hooks';
import { getDnsServers, dnsLookup, dnsLookupOne, cachedDnsLookup, cachedDnsLookupOne, clearDnsCache } from '../../../src/lib/dns.js';
import { getFailureSource } from '../../../src/lib/internal-error.js';
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

	afterEach(() => {
		clearDnsCache();
		sandbox.restore();
	});

	it('returns the first public address with its family', async () => {
		expect(await dnsLookup('example.com', { family: 4 })).to.deep.equal([ '1.1.1.1', 4 ]);
	});

	it('returns only the selected public address', async () => {
		resolve4.resolves([{ address: '192.168.0.1', ttl: 300 }, { address: '1.1.1.1', ttl: 300 }]);

		expect(await dnsLookupOne('example.com', { family: 4 })).to.equal('1.1.1.1');
	});

	it('tries the next configured resolver after SERVFAIL', async () => {
		sandbox.stub(dns.promises.Resolver.prototype, 'getServers').returns([ '192.0.2.1', '1.1.1.1' ]);
		const setServers = sandbox.spy(dns.promises.Resolver.prototype, 'setServers');
		resolve4.onFirstCall().rejects(Object.assign(new Error('queryA ESERVFAIL example.com'), { code: 'ESERVFAIL' }));
		resolve4.onSecondCall().resolves([{ address: '1.1.1.1', ttl: 300 }]);

		expect(await dnsLookup('example.com', { family: 4 })).to.deep.equal([ '1.1.1.1', 4 ]);
		expect(setServers.getCalls().map(call => call.args[0])).to.deep.equal([ [ '192.0.2.1' ], [ '1.1.1.1' ] ]);
	});

	it('tries the next configured resolver for cached lookups after SERVFAIL', async () => {
		sandbox.stub(dns.promises.Resolver.prototype, 'getServers').returns([ '192.0.2.1', '1.1.1.1' ]);
		const setServers = sandbox.spy(dns.promises.Resolver.prototype, 'setServers');
		resolve4.onFirstCall().rejects(Object.assign(new Error('queryA ESERVFAIL example.com'), { code: 'ESERVFAIL' }));
		resolve4.onSecondCall().resolves([{ address: '1.1.1.1', ttl: 300 }]);

		expect(await cachedDnsLookup('example.com', { family: 4 })).to.deep.equal([ '1.1.1.1', 4 ]);
		expect(setServers.getCalls().map(call => call.args[0])).to.deep.equal([ [ '192.0.2.1' ], [ '1.1.1.1' ] ]);
	});

	it('does not fall back from an explicitly selected resolver', async () => {
		resolve4.onFirstCall().rejects(Object.assign(new Error('queryA ESERVFAIL example.com'), { code: 'ESERVFAIL' }));
		resolve4.onSecondCall().resolves([{ address: '1.1.1.1', ttl: 300 }]);

		let error;

		try {
			await dnsLookup('example.com', { family: 4, server: '192.0.2.1' });
		} catch (caughtError) {
			error = caughtError as Error;
		}

		expect(error?.message).to.equal('queryA ESERVFAIL example.com');
	});

	it('does not fall back after an authoritative missing-name response', async () => {
		sandbox.stub(dns.promises.Resolver.prototype, 'getServers').returns([ '192.0.2.1', '1.1.1.1' ]);
		resolve4.onFirstCall().rejects(Object.assign(new Error('queryA ENOTFOUND example.com'), { code: 'ENOTFOUND' }));
		resolve4.onSecondCall().resolves([{ address: '1.1.1.1', ttl: 300 }]);

		let error;

		try {
			await dnsLookup('example.com', { family: 4 });
		} catch (caughtError) {
			error = caughtError as Error;
		}

		expect(error?.message).to.equal('queryA ENOTFOUND example.com');
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
		expect(getFailureSource(threw, 'internal')).to.equal('target');
	});

	it('classifies missing target records as target', async () => {
		resolve4.resolves([]);

		let failureSource;

		try {
			await dnsLookup('example.com', { family: 4 });
		} catch (error) {
			failureSource = getFailureSource(error, 'internal');
		}

		expect(failureSource).to.equal('target');
	});

	it('classifies ENOTFOUND as target', async () => {
		const error = Object.assign(new Error('queryA ENOTFOUND example.com'), { code: 'ENOTFOUND' });
		resolve4.rejects(error);

		let failureSource;

		try {
			await dnsLookup('example.com', { family: 4 });
		} catch (error) {
			failureSource = getFailureSource(error, 'internal');
		}

		expect(failureSource).to.equal('target');
	});

	it('classifies resolver failures as internal', async () => {
		const error = Object.assign(new Error('queryA ETIMEOUT example.com'), { code: 'ETIMEOUT' });
		resolve4.rejects(error);

		let failureSource;

		try {
			await dnsLookup('example.com', { family: 4 });
		} catch (error) {
			failureSource = getFailureSource(error, 'target');
		}

		expect(failureSource).to.equal('resolver');
	});

	it('returns a private address when allowPrivate is set', async () => {
		resolve4.resolves([{ address: '192.168.0.1', ttl: 300 }]);

		expect(await dnsLookup('example.com', { family: 4, allowPrivate: true })).to.deep.equal([ '192.168.0.1', 4 ]);
	});

	it('cachedDnsLookup resolves once per key, dnsLookup every time', async () => {
		await cachedDnsLookup('example.com', { family: 4 });
		await cachedDnsLookup('example.com', { family: 4 });
		expect(resolve4.callCount).to.equal(1);

		await dnsLookup('example.com', { family: 4 });
		await dnsLookup('example.com', { family: 4 });
		expect(resolve4.callCount).to.equal(3);
	});

	it('caches records for at least one minute', async () => {
		let now = 0;
		sandbox.stub(performance, 'now').callsFake(() => now);
		const clock = sandbox.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
		resolve4.resolves([{ address: '1.1.1.1', ttl: 0 }]);

		await cachedDnsLookup('example.com', { family: 4 });
		now = 59_999;
		await clock.tickAsync(59_999);
		await cachedDnsLookup('example.com', { family: 4 });

		expect(resolve4.callCount).to.equal(1);

		now = 60_000;
		await clock.tickAsync(1);
		await cachedDnsLookup('example.com', { family: 4 });

		expect(resolve4.callCount).to.equal(2);
	});

	it('honors authoritative ttls longer than five minutes', async () => {
		let now = 0;
		sandbox.stub(performance, 'now').callsFake(() => now);
		const clock = sandbox.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
		resolve4.resolves([{ address: '1.1.1.1', ttl: 600 }]);

		await cachedDnsLookup('example.com', { family: 4 });
		now = 5 * 60 * 1000 + 1;
		await clock.tickAsync(5 * 60 * 1000 + 1);
		await cachedDnsLookup('example.com', { family: 4 });

		expect(resolve4.callCount).to.equal(1);

		now = 10 * 60 * 1000;
		await clock.tickAsync(5 * 60 * 1000 - 1);
		await cachedDnsLookup('example.com', { family: 4 });

		expect(resolve4.callCount).to.equal(2);
	});

	it('keeps at most 5000 entries', async () => {
		resolve4.resolves([{ address: '1.1.1.1', ttl: 300 }]);

		for (let i = 0; i < 5001; i++) {
			await cachedDnsLookup(`example-${i}.com`, { family: 4 });
		}

		await cachedDnsLookup('example-1.com', { family: 4 });
		expect(resolve4.callCount).to.equal(5001);

		await cachedDnsLookup('example-0.com', { family: 4 });
		expect(resolve4.callCount).to.equal(5002);
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

	it('stops waiting on an aborted signal without cancelling the cached lookup', async () => {
		let finishLookup!: (records: Array<{ address: string; ttl: number }>) => void;

		resolve4.returns(new Promise((resolve) => {
			finishLookup = resolve;
		}));

		const controller = new AbortController();
		const lookup = cachedDnsLookup('example.com', { family: 4, signal: controller.signal });
		controller.abort(new Error('Measurement timeout.'));

		let error;

		try {
			await lookup;
		} catch (caughtError) {
			error = caughtError;
		}

		expect(error).to.be.instanceOf(Error).with.property('message', 'Measurement timeout.');

		finishLookup([{ address: '1.1.1.1', ttl: 300 }]);
		expect(await cachedDnsLookup('example.com', { family: 4 })).to.deep.equal([ '1.1.1.1', 4 ]);
		expect(resolve4.callCount).to.equal(1);
	});

	it('does not start an uncached lookup with an already-aborted signal', async () => {
		const controller = new AbortController();
		controller.abort(new Error('Measurement timeout.'));
		let error;

		try {
			await dnsLookup('example.com', { family: 4, signal: controller.signal });
		} catch (caughtError) {
			error = caughtError;
		}

		expect(error).to.equal(controller.signal.reason);
		expect(resolve4.notCalled).to.be.true;
	});

	it('does not start a cached lookup with an already-aborted signal', async () => {
		const controller = new AbortController();
		controller.abort(new Error('Measurement timeout.'));
		let error;

		try {
			await cachedDnsLookup('example.com', { family: 4, signal: controller.signal });
		} catch (caughtError) {
			error = caughtError;
		}

		expect(error).to.equal(controller.signal.reason);
		expect(resolve4.notCalled).to.be.true;
	});

	it('returns a completed cached lookup with an already-aborted signal', async () => {
		await cachedDnsLookup('example.com', { family: 4 });
		const controller = new AbortController();
		controller.abort(new Error('Measurement timeout.'));

		expect(await cachedDnsLookup('example.com', { family: 4, signal: controller.signal })).to.deep.equal([ '1.1.1.1', 4 ]);
		expect(resolve4.calledOnce).to.be.true;
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

	it('returns only the first cached record without truncating the cache entry', async () => {
		const resolveTxt = sandbox.stub(dns.promises.Resolver.prototype, 'resolveTxt').resolves([ [ 'AS123', ' | abc' ], [ 'AS456' ] ]);

		expect(await cachedDnsLookupOne('example.com', { rrtype: 'TXT' })).to.equal('AS123 | abc');
		expect(await cachedDnsLookup('example.com', { rrtype: 'TXT' })).to.deep.equal([ 'AS123 | abc', 'AS456' ]);
		expect(resolveTxt.callCount).to.equal(1);
	});

	it('returns PTR records from a reverse lookup', async () => {
		const reverse = sandbox.stub(dns.promises.Resolver.prototype, 'reverse').resolves([ 'one.one.one.one' ]);

		expect(await cachedDnsLookup('1.1.1.1', { rrtype: 'PTR' })).to.deep.equal([ 'one.one.one.one' ]);
		expect(reverse.calledOnceWithExactly('1.1.1.1')).to.be.true;
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
