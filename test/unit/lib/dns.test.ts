import { expect } from 'chai';
import * as sinon from 'sinon';
import { getDnsServers, cachedResolve, clearDnsCache } from '../../../src/lib/dns.js';
import { useSandboxWithFakeTimers } from '../../utils.js';

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

describe('cachedResolve', () => {
	beforeEach(() => {
		clearDnsCache();
	});

	it('resolves once per key within the TTL', async () => {
		const resolve = sinon.stub().resolves([ '1.1.1.1' ]);

		const first = await cachedResolve(resolve, 'example.com', 'A');
		const second = await cachedResolve(resolve, 'example.com', 'A');

		expect(first).to.deep.equal([ '1.1.1.1' ]);
		expect(second).to.deep.equal([ '1.1.1.1' ]);
		expect(resolve.callCount).to.equal(1);
	});

	it('keys by record type', async () => {
		const resolve = sinon.stub();
		resolve.withArgs('example.com', 'A').resolves([ '1.1.1.1' ]);
		resolve.withArgs('example.com', 'TXT').resolves([ 'v=spf1' ]);

		await cachedResolve(resolve, 'example.com', 'A');
		await cachedResolve(resolve, 'example.com', 'TXT');
		await cachedResolve(resolve, 'example.com', 'A');

		expect(resolve.callCount).to.equal(2);
	});

	it('dedupes concurrent in-flight lookups', async () => {
		const resolve = sinon.stub().resolves([ '1.1.1.1' ]);

		await Promise.all([ cachedResolve(resolve, 'example.com', 'A'), cachedResolve(resolve, 'example.com', 'A') ]);

		expect(resolve.callCount).to.equal(1);
	});

	it('re-resolves after the entry expires', async () => {
		const sandbox = useSandboxWithFakeTimers();

		try {
			sandbox.stub(performance, 'now').callsFake(() => sandbox.clock.now);
			const resolve = sandbox.stub().resolves([ '1.1.1.1' ]);

			await cachedResolve(resolve, 'example.com', 'A');
			await sandbox.clock.tickAsync(5 * 60 * 1000 + 1000);
			await cachedResolve(resolve, 'example.com', 'A');

			expect(resolve.callCount).to.equal(2);
		} finally {
			sandbox.restore();
		}
	});

	it('does not cache failures', async () => {
		const resolve = sinon.stub();
		resolve.onFirstCall().rejects(new Error('ENOTFOUND'));
		resolve.onSecondCall().resolves([ '1.1.1.1' ]);

		let threw = false;

		try {
			await cachedResolve(resolve, 'example.com', 'A');
		} catch {
			threw = true;
		}

		const second = await cachedResolve(resolve, 'example.com', 'A');

		expect(threw).to.be.true;
		expect(second).to.deep.equal([ '1.1.1.1' ]);
		expect(resolve.callCount).to.equal(2);
	});
});
