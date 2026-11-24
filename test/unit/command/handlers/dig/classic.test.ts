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

		it('redacts private resolvers from error lines and keeps the records', () => {
			const output = [
				';; communications error to 192.168.1.1#53: timed out',
				';; Connection to fd00::53#53(fd00::53) for example.com failed: connection refused.',
				';; communications error to 9.9.9.9#53: timed out',
				'example.com.\t60\tIN\tA\t10.0.0.1',
				';; no servers could be reached',
			].join('\n');

			expect(ClassicDigParser.rewrite(output)).to.equal([
				';; communications error to x.x.x.x#53: timed out',
				';; Connection to x.x.x.x#53(x.x.x.x) for example.com failed: connection refused.',
				';; communications error to 9.9.9.9#53: timed out',
				'example.com.\t60\tIN\tA\t10.0.0.1',
				';; no servers could be reached',
			].join('\n'));
		});
	});
});
