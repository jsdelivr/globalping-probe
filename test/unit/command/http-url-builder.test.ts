import { expect } from 'chai';
import { Test } from '../../../src/command/http-test.js';

describe('http url builder', () => {
	const buffer = {} as any;

	describe('prefix', () => {
		it('should set http:// prefix (HTTP)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/');
		});

		it('should set https:// prefix (HTTPS)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTPS',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('https://google.com:443/');
		});

		it('should set https:// prefix (HTTP2)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP2',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('https://google.com:443/');
		});
	});

	describe('target', () => {
		it('should enclose an IPv6 addresses in brackets', () => {
			const options = {
				type: 'http' as const,
				target: '2606:4700:4700::1111',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://[2606:4700:4700::1111]:80/');
		});

		it('should not enclose an IPv4 addresses in brackets', () => {
			const options = {
				type: 'http' as const,
				target: '1.1.1.1',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://1.1.1.1:80/');
		});

		it('should enclose a domain in brackets', () => {
			const options = {
				type: 'http' as const,
				target: 'jsdelivr.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 6,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://jsdelivr.com:80/');
		});
	});

	describe('port', () => {
		it('should set custom port', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				port: 1212,
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:1212/');
		});

		it('should set default HTTP port', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/');
		});

		it('should set default HTTPS port', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTPS',
				request: {
					method: 'GET',
					path: '/',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('https://google.com:443/');
		});
	});

	describe('path', () => {
		it('should prefix pathname with (/) sign', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: 'abc',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/abc');
		});

		it('should append pathname at the end of url (prevent double /)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/abc',
					query: '',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/abc');
		});
	});

	describe('query', () => {
		it('should prefix query with (?) sign', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: 'abc=def',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/?abc=def');
		});

		it('should append query at the end of url (prevent double ?)', () => {
			const options = {
				type: 'http' as const,
				target: 'google.com',
				protocol: 'HTTP',
				request: {
					method: 'GET',
					path: '/',
					query: '?abc=def',
				},
				inProgressUpdates: false,
				ipVersion: 4,
			};

			const url = new Test(options, buffer).urlBuilder();

			expect(url).to.equal('http://google.com:80/?abc=def');
		});
	});
});

