import { expect } from 'chai';
import { truncateHeaderPairs } from '../../../../../src/command/handlers/http/truncate-headers.js';
import { hasLoneSurrogate } from '../../../../utils.js';

const repeat = (char: string, n: number) => char.repeat(n);

const sumChars = (pairs: [string, string][]) => pairs.reduce((sum, [ k, v ]) => sum + k.length + v.length + 3, 0) - 1;

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
			expect(sumChars(result.headers)).to.equal(10_000);
			expect(result.headers[0]![1].endsWith('...[truncated]')).to.equal(true);
			expect(result.headers[0]![1].length).to.equal(10_000 - 'x-huge'.length - 2);
		});

		it('does not split a surrogate pair when truncating an oversized value', () => {
			const pairs: [string, string][] = [
				[ 'x-huge', repeat('a', 9966) + '😀' + repeat('c', 20) ],
				[ 'x-small', 'b' ],
			];

			const result = truncateHeaderPairs(pairs);
			const value = result.headers[0]![1];

			expect(result.truncated).to.equal(true);
			expect(sumChars(result.headers)).to.equal(9999);
			expect(value.endsWith('...[truncated]')).to.equal(true);
			expect(hasLoneSurrogate(value)).to.equal(false);
			expect(JSON.stringify(result.headers)).not.to.include('\\ud83d');
			expect(JSON.stringify(result.headers)).not.to.include('\\ude00');
		});

		it('keeps small values untouched while truncating one giant', () => {
			const pairs: [string, string][] = [
				[ 'x-huge', repeat('a', 20_000) ],
				[ 'server', 'nginx' ],
				[ 'content-type', 'text/html' ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(sumChars(result.headers)).to.equal(10_000);
			expect(result.headers[0]![1].endsWith('...[truncated]')).to.equal(true);
			expect(result.headers[1]).to.deep.equal([ 'server', 'nginx' ]);
			expect(result.headers[2]).to.deep.equal([ 'content-type', 'text/html' ]);
		});

		it('truncates equal-sized giants to the same length', () => {
			const pairs: [string, string][] = [
				[ 'a', repeat('x', 99_999) ],
				[ 'b', repeat('y', 99_998) ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(result.headers[0]![1].length).to.equal(result.headers[1]![1].length);
			expect(sumChars(result.headers)).to.equal(9999);
			expect(result.headers[0]![1].endsWith('...[truncated]')).to.equal(true);
			expect(result.headers[1]![1].endsWith('...[truncated]')).to.equal(true);
		});

		it('matches the documented [80, 60, 20] example scaled up to real bytes', () => {
			const pairs: [string, string][] = [
				[ 'a', repeat('x', 8000) ],
				[ 'b', repeat('y', 6000) ],
				[ 'c', repeat('z', 2000) ],
			];

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(sumChars(result.headers)).to.equal(9999);
			// First two are the giants, both should be truncated to the same length.
			expect(result.headers[0]![1].length).to.equal(result.headers[1]![1].length);
			expect(result.headers[2]).to.deep.equal([ 'c', repeat('z', 2000) ]);
		});
	});

	describe('values phase keeps headers instead of dropping them', () => {
		it('keeps a big-key header (truncating values) instead of dropping it', () => {
			const pairs: [string, string][] = [
				[ repeat('K', 6000), 'small' ],
				[ 'server', repeat('v', 5000) ],
			];
			// minSize fits (key + marker + framing), so nothing is dropped — the
			// 5000-char value is truncated instead.

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(result.headers).to.have.lengthOf(2);
			expect(result.headers[0]![0].startsWith('K')).to.equal(true);
			expect(result.headers[1]![1].endsWith('...[truncated]')).to.equal(true);
			expect(sumChars(result.headers)).to.equal(10_000);
		});
	});

	describe('drop phase (names too large to fit even when values are truncated)', () => {
		it('drops the largest header when minimal footprints cannot all fit', () => {
			const pairs: [string, string][] = [
				[ repeat('X', 9990), 'tiny' ], // name alone ~ the whole budget
				[ 'content-type', 'text/html' ],
				[ 'server', 'nginx' ],
			];
			// minSize (9990 + marker + ... + 24 + 14) > 10_000 -> the giant-name
			// header is dropped; the two small headers stay intact.

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(result.headers).to.have.lengthOf(2);
			expect(result.headers.find(([ k ]) => k.startsWith('X'))).to.equal(undefined);

			expect(result.headers).to.deep.equal([
				[ 'content-type', 'text/html' ],
				[ 'server', 'nginx' ],
			]);
		});

		it('drops the biggest headers first, keeping as many as possible', () => {
			const pairs: [string, string][] = Array.from({ length: 5 }, (_, i): [string, string] => [ repeat('N', 3000), `v${i}` ]);

			const result = truncateHeaderPairs(pairs);

			expect(result.truncated).to.equal(true);
			expect(result.headers).to.have.lengthOf(3);

			expect(result.headers).to.deep.equal([
				[ repeat('N', 3000), 'v2' ],
				[ repeat('N', 3000), 'v3' ],
				[ repeat('N', 3000), 'v4' ],
			]);

			expect(sumChars(result.headers)).to.equal(9014); // 3 * (3000 + 2 + 3) - 1
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
