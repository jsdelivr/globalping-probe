import {promisify} from 'node:util';
import {expect} from 'chai';
import {dnsLookup} from '../../../../../src/command/handlers/http/dns-resolver.js';
import type {ResolverType, ResolverOptionsType, ResolverCallbackType} from '../../../../../src/command/handlers/http/dns-resolver.js';

export const buildResolver = (ipList: string[]): ResolverType => (_hostname: string, _options: ResolverOptionsType, cb: ResolverCallbackType): void => {
	cb(null, ipList);
};

describe('http helper', () => {
	describe('dns', () => {
		it('should return an error (private ip)', async () => {
			const data = {
				ipList: ['192.168.0.1'],
				hostname: 'abc.com',
				options: {
					family: 4,
				},
			};

			const resolver = buildResolver(data.ipList);
			const lookup = promisify(dnsLookup(undefined, resolver));

			let response: unknown;

			try {
				response = await lookup(data.hostname, data.options) as string;
			} catch (error: unknown) {
				response = error;
			}

			expect(response).to.be.instanceof(Error);
		});

		it('should filter out private ip, return public ip', async () => {
			const data = {
				ipList: ['192.168.0.1', '1.1.1.1'],
				hostname: 'abc.com',
				options: {
					family: 4,
				},
			};

			const resolver = buildResolver(data.ipList);
			const lookup = promisify(dnsLookup(undefined, resolver));

			let response: unknown;

			try {
				response = await lookup(data.hostname, data.options) as string;
			} catch (error: unknown) {
				response = error;
			}

			expect(response).to.equal('1.1.1.1');
		});
	});
});
