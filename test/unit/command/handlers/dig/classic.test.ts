import { expect } from 'chai';
import ClassicDigParser from '../../../../../src/command/handlers/dig/classic.js';

describe('classic dig parser', () => {
	describe('rewrite', () => {
		it('redacts a private resolver from fallback diagnostics', () => {
			const output = [
				'; <<>> DiG <<>> example.com',
				';; Got SERVFAIL reply from 192.168.0.53, trying next server',
				';; SERVER: 1.1.1.1#53(1.1.1.1)',
			].join('\n');

			expect(ClassicDigParser.rewrite(output)).to.equal([
				'; <<>> DiG <<>> example.com',
				';; Got SERVFAIL reply from x.x.x.x, trying next server',
				';; SERVER: 1.1.1.1#53(1.1.1.1)',
			].join('\n'));
		});

		it('redacts a private IPv6 resolver from fallback diagnostics', () => {
			const output = [
				'; <<>> DiG <<>> example.com',
				';; Got SERVFAIL reply from fd00::53, trying next server',
				';; SERVER: 1.1.1.1#53(1.1.1.1)',
			].join('\n');

			expect(ClassicDigParser.rewrite(output)).to.equal([
				'; <<>> DiG <<>> example.com',
				';; Got SERVFAIL reply from x.x.x.x, trying next server',
				';; SERVER: 1.1.1.1#53(1.1.1.1)',
			].join('\n'));
		});
	});
});
