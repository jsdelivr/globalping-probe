import {expect} from 'chai';
import {dnsLookup, callbackify} from '../../../../../src/command/handlers/http/dns-resolver.js';
import type {ResolverType, ResolverOptionsType} from '../../../../../src/command/handlers/http/dns-resolver.js';

export const buildResolver = (ipList: string[]): ResolverType => async (_hostname: string, _options: ResolverOptionsType): Promise<string[]> => ipList;

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
			const lookup = dnsLookup(undefined, resolver);

			let response: unknown;

			try {
				response = await lookup(
					data.hostname,
					// @ts-expect-error family type error
					data.options,
				) as [string, number];
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
			const lookup = dnsLookup(undefined, resolver);

			let response: unknown;

			try {
				response = await lookup(
					data.hostname,
					// @ts-expect-error family type error
					data.options,
				) as [string, number];
			} catch (error: unknown) {
				response = error;
			}

			expect(response).to.deep.equal(['1.1.1.1', 4]);
		});

		it('should pass - callbackify', () => {
			const data = {
				ipList: ['192.168.0.1', '1.1.1.1'],
				hostname: 'abc.com',
				options: {
					family: 4,
				},
			};

			const resolver = buildResolver(data.ipList);
			const lookup = callbackify(dnsLookup(undefined, resolver));

			lookup(
				data.hostname,
				data.options,
				(_error: undefined, result: string, family: number) => {
					expect(result).to.equal('1.1.1.1');
					expect(family).to.equal(4);
				},
			);
		});
	});
});
