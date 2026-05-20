const HEADERS_SIZE_LIMIT = 10_000;
const HEADER_TRUNCATION_MARK = '...[truncated]';
const RAW_HEADERS_EXTRA_SYMBOLS_SIZE = 3; // ": " between key and value + "\n" line separator.

type TruncateHeaderPairsResult = {
	truncated: boolean;
	headers: [string, string][];
};

const pairSize = (k: string, v: string) => k.length + v.length + RAW_HEADERS_EXTRA_SYMBOLS_SIZE;
const pairMinSize = (k: string, v: string) => k.length + Math.min(v.length, HEADER_TRUNCATION_MARK.length) + RAW_HEADERS_EXTRA_SYMBOLS_SIZE;

export function truncateHeaderPairs (pairs: [string, string][]): TruncateHeaderPairsResult {
	let size = 0;
	let minSize = 0;

	for (const [ k, v ] of pairs) {
		size += pairSize(k, v);
		minSize += pairMinSize(k, v);
	}

	// Remove the last "\n" line separator.
	size -= 1;
	minSize -= 1;

	// Fast path: everything fits, no truncation needed.
	if (size <= HEADERS_SIZE_LIMIT) {
		return { truncated: false, headers: pairs };
	}

	let kept = pairs;

	// Remove headers phase: drop pairs with the largest min size until values are able to fit by shrinking.
	if (minSize > HEADERS_SIZE_LIMIT) {
		const orderedByMin = pairs
			.map((p, i) => ({ i, min: pairMinSize(...p) }))
			.sort((a, b) => b.min - a.min);
		const droppedIndexes = new Set<number>();

		for (const { i, min } of orderedByMin) {
			if (minSize <= HEADERS_SIZE_LIMIT) {
				break;
			}

			droppedIndexes.add(i);
			size -= pairSize(...pairs[i]!);
			minSize -= min;
		}

		kept = pairs.filter((_, i) => !droppedIndexes.has(i));
	}

	if (size <= HEADERS_SIZE_LIMIT) {
		return { truncated: true, headers: kept };
	}

	// Shrink values phase: imagine lowering a uniform length cap L from infinity down.
	// At each step L drops from sortedLengths[N-1] to sortedLengths[N], which
	// uniformly clips the top N values; the total falls by N * (drop in L). Walk
	// down step by step until the total dips under the budget, then back off to the
	// exact L that hits the budget.
	//
	// Example: values [80, 60, 20], budget 100. valuesSize = 160.
	//   N=1: lower L 80 -> 60.  reduction = 1*(80-60) = 20.  total: 160 -> 140  (still > 100).
	//   N=2: lower L 60 -> 20.  reduction = 2*(60-20) = 80.  total: 140 -> 60   (under, overshot).
	//        Exact L: 60 - (140 - 100) / 2 = 40.
	// Result: the top two values truncated to 40, the 20-value stays (40+40+20 = 100).
	const sortedLengths = kept.map(([ , v ]) => v.length).sort((a, b) => b - a);
	const valuesSize = sortedLengths.reduce((sum, n) => sum + n, 0);
	const valueBudget = HEADERS_SIZE_LIMIT - size + valuesSize;
	let total = valuesSize;
	let cap = 0;

	for (let N = 1; N <= sortedLengths.length; N++) {
		const len = sortedLengths[N - 1]!;
		const nextLen = N < sortedLengths.length ? sortedLengths[N]! : 0;
		const reduction = N * (len - nextLen);

		if (total - reduction <= valueBudget) {
			cap = Math.floor(len - (total - valueBudget) / N);
			break;
		}

		total -= reduction;
	}

	cap = Math.max(cap, HEADER_TRUNCATION_MARK.length);

	const headers = kept.map(([ k, v ]): [string, string] => v.length > cap
		? [ k, v.substring(0, cap - HEADER_TRUNCATION_MARK.length) + HEADER_TRUNCATION_MARK ]
		: [ k, v ]);

	return { truncated: true, headers };
}
