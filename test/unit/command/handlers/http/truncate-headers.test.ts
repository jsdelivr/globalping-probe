import { expect } from 'chai';
import { truncateHeaderPairs } from '../../../../../src/command/handlers/http/truncate-headers.js';

const repeat = (char: string, n: number) => char.repeat(n);

const sumChars = (pairs: [string, string][]) => pairs.reduce((sum, [ k, v ]) => sum + k.length + v.length, 0);

describe('truncateHeaderPairs', () => {
	describe('fast path', () => {
		it('returns input unchanged and truncated=false when totals fit the budget', () => {
			const pairs: [string, string][] = [
				[ 'content-type', 'application/json' ],
				[ 'server', 'nginx' ],
				[ 'cache-control', 'no-store' ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(false);
			expect(result.headers).to.equal(pairs);
		});
	});

	describe('values phase only (keys fit half-budget)', () => {
		it('truncates a single oversized value down to fit the budget', () => {
			const pairs: [string, string][] = [
				[ 'x-huge', repeat('a', 20_000) ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(sumChars(result.headers)).to.be.at.most(10_000);
			expect(result.headers[0]![1].endsWith('...[truncated]')).to.equal(true);
			expect(result.headers[0]![1].length).to.equal(10_000 - 'x-huge'.length);
		});

		it('keeps small values untouched while truncating one giant', () => {
			const pairs: [string, string][] = [
				[ 'x-huge', repeat('a', 20_000) ],
				[ 'server', 'nginx' ],
				[ 'content-type', 'text/html' ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(sumChars(result.headers)).to.be.at.most(10_000);
			expect(result.headers[0]![1].endsWith('...[truncated]')).to.equal(true);
			expect(result.headers[1]).to.deep.equal([ 'server', 'nginx' ]);
			expect(result.headers[2]).to.deep.equal([ 'content-type', 'text/html' ]);
			expect(result.headers[0]![1].endsWith('...[truncated]')).to.equal(true);
		});

		it('truncates equal-sized giants to the same length', () => {
			const pairs: [string, string][] = [
				[ 'a', repeat('x', 99_999) ],
				[ 'b', repeat('y', 99_998) ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(result.headers[0]![1].length).to.equal(result.headers[1]![1].length);
			expect(sumChars(result.headers)).to.be.at.most(10_000);
			expect(result.headers[0]![1].endsWith('...[truncated]')).to.equal(true);
			expect(result.headers[1]![1].endsWith('...[truncated]')).to.equal(true);
		});

		it('matches the documented [80, 60, 20] example scaled up to real bytes', () => {
			// values 8000, 6000, 2000 (sum 16000) with no keys -> value budget = 10000 minus key bytes.
			const pairs: [string, string][] = [
				[ 'a', repeat('x', 8000) ],
				[ 'b', repeat('y', 6000) ],
				[ 'c', repeat('z', 2000) ],
			];

			// keys total = 3, value budget = 9997. Expected: top 2 capped to (9997 - 2000) / 2 = 3998 (or 3998 floored).
			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(sumChars(result.headers)).to.be.at.most(10_000);
			// First two are the giants, both should be truncated to the same length.
			expect(result.headers[0]![1].length).to.equal(result.headers[1]![1].length);
			expect(result.headers[2]).to.deep.equal([ 'c', repeat('z', 2000) ]);
		});
	});

	describe('keys phase (total over the limit AND keys over half-budget)', () => {
		it('drops the pair with the biggest key when keys exceed half-budget', () => {
			const pairs: [string, string][] = [
				[ repeat('K', 6000), 'small' ], // 6005 — keys phase target
				[ 'server', repeat('v', 5000) ], // 5006
			];
			// keysSize = 6006, valuesSize = 5005, total = 11_011 > 10_000.
			// keys > 5000 -> drop biggest key. After drop: keys=6, values=5000.

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(result.headers).to.have.lengthOf(1);
			expect(result.headers[0]![0]).to.equal('server');
		});

		it('keeps as many pairs as possible by dropping the biggest key first', () => {
			const pairs: [string, string][] = [
				[ repeat('B', 4000), 'v' ], // 4001
				[ repeat('A', 2000), 'v' ], // 2001
				[ 'small', repeat('v', 5000) ], // 5005
			];
			// keysSize = 6005, valuesSize = 5002, total = 11_007 > 10_000.
			// Drop biggest key (4000) -> keys=2005, values=5001 -> total=7006 fits.

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(result.headers).to.have.lengthOf(2);
			expect(result.headers.find(([ k ]) => k.startsWith('B'))).to.equal(undefined);
			expect(result.headers.find(([ k ]) => k.startsWith('A'))).to.not.equal(undefined);
		});
	});

	describe('output integrity', () => {
		it('preserves the original pair order after truncation', () => {
			const pairs: [string, string][] = [
				[ 'a', repeat('x', 6000) ],
				[ 'b', 'short' ],
				[ 'c', repeat('y', 6000) ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.headers.map(([ k ]) => k)).to.deep.equal([ 'a', 'b', 'c' ]);
		});

		it('preserves original key casing', () => {
			const pairs: [string, string][] = [
				[ 'Content-Type', 'text/html' ],
				[ 'X-Huge', repeat('a', 20_000) ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.headers[0]![0]).to.equal('Content-Type');
			expect(result.headers[1]![0]).to.equal('X-Huge');
		});
	});
});
