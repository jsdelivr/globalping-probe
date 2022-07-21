import {expect} from 'chai';
import {getDnsServers} from '../../../../src/lib/dns.js';

const client = (list: string[]) => () => list;

describe('dns lib', () => {
	describe('ipv6', () => {
		it('should filter out ipv6', () => {
			const input = [
				'1.1.1.1',
				'2001:4860:4860::8888',
			];

			const servers = getDnsServers(client(input));

			expect(servers.length).to.equal(1);
			expect(servers).to.deep.equal([
				'1.1.1.1',
			]);
		});

		it('should filter out ipv6 (with port)', () => {
			const input = [
				'1.1.1.1',
				'[2001:4860:4860::8888]:53',
			];

			const servers = getDnsServers(client(input));

			expect(servers.length).to.equal(1);
			expect(servers).to.deep.equal([
				'1.1.1.1',
			]);
		});
	});

	describe('private ip', () => {
		it('should mask private ip', () => {
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
	});
});
