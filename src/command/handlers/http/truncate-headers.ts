const HEADERS_SIZE_LIMIT = 10_000;
const HEADER_KEYS_SIZE_LIMIT = HEADERS_SIZE_LIMIT / 2; // Reserve half of the budget for values.
const HEADER_TRUNCATION_MARK = '...[truncated]';
const RAW_HEADERS_EXTRA_SYMBOLS_SIZE = 3;

type TruncateHeaderPairsResult = {
	truncated: boolean;
	headers: [string, string][];
};

export function truncateHeaderPairs (pairs: [string, string][]): TruncateHeaderPairsResult {
	let keysSize = 0;
	let valuesSize = 0;

	for (const [ k, v ] of pairs) {
		keysSize += k.length + RAW_HEADERS_EXTRA_SYMBOLS_SIZE;
		valuesSize += v.length;
	}

	keysSize -= 1; // Remove the last "\n" line separator.

	// Fast path: total fits, no truncation needed.
	if (keysSize + valuesSize <= HEADERS_SIZE_LIMIT) {
		return { truncated: false, headers: pairs };
	}

	let kept = pairs;

	// Keys phase: drop pairs with the largest keys until the keys budget fits.
	if (keysSize > HEADER_KEYS_SIZE_LIMIT) {
		const sortedIndexesDesc = pairs.map((_, i) => i).sort((a, b) => pairs[b]![0].length - pairs[a]![0].length);
		const droppedIndexes = new Set<number>();

		for (const i of sortedIndexesDesc) {
			if (keysSize <= HEADER_KEYS_SIZE_LIMIT) {
				break;
			}

			droppedIndexes.add(i);
			keysSize -= pairs[i]![0].length + RAW_HEADERS_EXTRA_SYMBOLS_SIZE;
			valuesSize -= pairs[i]![1].length;
		}

		kept = pairs.filter((_, i) => !droppedIndexes.has(i));
	}

	const valueBudget = HEADERS_SIZE_LIMIT - keysSize;

	if (valuesSize <= valueBudget) {
		return { truncated: true, headers: kept };
	}

	// Values phase: imagine lowering a uniform length cap L from infinity down.
	// At each step L drops from sortedLengths[N-1] to sortedLengths[N], which
	// uniformly clips the top N values; total falls by N * (drop in L). Walk
	// down step by step until total dips under the budget, then back off to the
	// exact L that hits the budget.
	//
	// Example: values [80, 60, 20], budget 100. valuesSize = 160.
	//   N=1: lower L 80 -> 60.  reduction = 1*(80-60) = 20.  total: 160 -> 140  (still > 100).
	//   N=2: lower L 60 -> 20.  reduction = 2*(60-20) = 80.  total: 140 -> 60   (under, overshot).
	//        Exact L: 60 - (140 - 100) / 2 = 40.
	// Result: top two values truncated to 40, the 20-value stays (40+40+20 = 100).
	const sortedLengths = kept.map(([ , v ]) => v.length).sort((a, b) => b - a);
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

	// If cap is less than the truncation marker, set marker as a value.
	cap = Math.max(cap, HEADER_TRUNCATION_MARK.length);

	const headers = kept.map(([ k, v ]): [string, string] => v.length > cap
		? [ k, v.substring(0, cap - HEADER_TRUNCATION_MARK.length) + HEADER_TRUNCATION_MARK ]
		: [ k, v ]);

	return { truncated: true, headers };
}
