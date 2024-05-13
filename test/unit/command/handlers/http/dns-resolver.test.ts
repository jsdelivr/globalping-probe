import { expect } from 'chai';
import * as td from 'testdouble';
import { callbackify } from '../../../../../src/lib/util.js';
import type { ResolverType, Options, ErrnoException, IpFamily } from '../../../../../src/command/handlers/http/dns-resolver.js';

export const buildResolver = (ipList: string[]): ResolverType => (): Promise<string[]> => Promise.resolve(ipList);

class NativeResolverMock {
	public resolve4: ResolverType;
	public resolve6: ResolverType;

	constructor () {
		this.resolve4 = buildResolver([ '1.1.1.1' ]);
		this.resolve6 = buildResolver([ '2606:4700:4700::1111' ]);
	}
}

describe('http helper', () => {
	let dnsLookup: (resolverAddr: string | undefined, resolverFn?: ResolverType) => (hostname: string, options: Options) => Promise<Error | ErrnoException | [string, number]>;

	before(async () => {
		await td.replaceEsm('node:dns', null, { promises: { Resolver: NativeResolverMock } });
		({ dnsLookup } = await import('../../../../../src/command/handlers/http/dns-resolver.js'));
	});

	after(() => {
		td.reset();
	});

	describe('dns', () => {
		it('should return an error (private ip)', async () => {
			const data = {
				ipList: [ '192.168.0.1' ],
				hostname: 'abc.com',
				options: {
					family: 4 as IpFamily,
				},
			};

			const resolver = buildResolver(data.ipList);
			const lookup = dnsLookup(undefined, resolver);

			let response: unknown;

			try {
				response = await lookup(
					data.hostname,
					data.options,
				) as [string, number];
			} catch (error: unknown) {
				response = error;
			}

			expect(response).to.be.instanceof(Error);
		});

		it('should filter out private ipv4, return public ipv4', async () => {
			const data = {
				ipList: [ '192.168.0.1', '1.1.1.1' ],
				hostname: 'abc.com',
				options: {
					family: 4 as IpFamily,
				},
			};

			const resolver = buildResolver(data.ipList);
			const lookup = dnsLookup(undefined, resolver);

			const response = await lookup(
				data.hostname,
				data.options,
			) as [string, number];

			expect(response).to.deep.equal([ '1.1.1.1', 4 ]);
		});

		it('should filter out private ipv6, return public ipv6', async () => {
			const data = {
				ipList: [ '64:ff9b:1::1a2b:3c4d', '2606:4700:4700::1111' ],
				hostname: 'abc.com',
				options: {
					family: 6 as IpFamily,
				},
			};

			const resolver = buildResolver(data.ipList);
			const lookup = dnsLookup(undefined, resolver);

			const response = await lookup(
				data.hostname,
				data.options,
			) as [string, number];

			expect(response).to.deep.equal([ '2606:4700:4700::1111', 6 ]);
		});

		it('should pass - callbackify', (done) => {
			const data = {
				ipList: [ '192.168.0.1', '1.1.1.1' ],
				hostname: 'abc.com',
				options: {
					family: 4 as IpFamily,
				},
			};

			const resolver = buildResolver(data.ipList);
			const lookup = callbackify(dnsLookup(undefined, resolver), true);

			lookup(
				data.hostname,
				data.options,
				(_error: undefined, result: string, family: number) => {
					expect(result).to.deep.equal('1.1.1.1');
					expect(family).to.equal(4);
					done();
				},
			);
		});

		it('should use native ipv4 resolver if not provided', async () => {
			const data = {
				hostname: 'abc.com',
				options: {
					family: 4 as IpFamily,
				},
			};

			const lookup = dnsLookup(undefined);

			const response = await lookup(
				data.hostname,
				data.options,
			) as [string, number];

			expect(response).to.deep.equal([ '1.1.1.1', 4 ]);
		});

		it('should use native ipv6 resolver if not provided', async () => {
			const data = {
				hostname: 'abc.com',
				options: {
					family: 6 as IpFamily,
				},
			};

			const lookup = dnsLookup(undefined);

			const response = await lookup(
				data.hostname,
				data.options,
			) as [string, number];

			expect(response).to.deep.equal([ '2606:4700:4700::1111', 6 ]);
		});
	});
});
