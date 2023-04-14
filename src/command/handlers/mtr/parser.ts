import type {
	HopStatsType,
	HopType,
} from './types.js';

export const NEW_LINE_REG_EXP = /\r?\n/;

const getInitialHopState = (): HopType => ({
	stats: {
		min: 0,
		max: 0,
		avg: 0,
		total: 0,
		loss: 0,
		rcv: 0,
		drop: 0,
		stDev: 0,
		jMin: 0,
		jMax: 0,
		jAvg: 0,
	},
	asn: [],
	timings: [],
});

const getSpacing = (length: number): string => Array.from({length}).fill(' ').join('');
const withSpacing = (string_: string | number, dSpacing: number, left = false): string => {
	const sSpacing = getSpacing(dSpacing - String(string_).length);

	if (left) {
		return `${sSpacing}${string_}`;
	}

	return `${string_}${sSpacing}`;
};

const roundNumber = (value: number): number => {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Number.parseFloat(value.toFixed(1));
};

export const MtrParser = {
	outputBuilder(hops: HopType[]): string {
		const rawOutput = [];

		const spacings = {
			index: String(hops.length).length,
			asn: 2 + Math.max(...hops.map(h => String(h?.asn.join(' ') ?? 0).length)),
			hostname: (3
        + Math.max(...hops.map(h => String(h?.resolvedAddress ?? 0).length))
        + Math.max(...hops.map(h => String(h?.resolvedHostname ?? 0).length))
			),
			loss: 6,
			drop: Math.max(4, ...hops.map(h => String(h?.stats?.drop ?? 0).length)),
			avg: Math.max(...hops.map(h => String(h?.stats?.avg ?? 0).length)),
			rcv: 2 + Math.max(...hops.map(h => String(h?.stats?.drop ?? 0).length)),
			stDev: 6,
			jAvg: 5,
		};

		const header = [
			withSpacing('Host', (spacings.index + spacings.asn + spacings.hostname + 4)),
			withSpacing('Loss%', spacings.loss, true),
			withSpacing('Drop', spacings.drop, true),
			withSpacing('Rcv', spacings.rcv, true),
			withSpacing('Avg', spacings.avg, true),
			withSpacing('StDev', spacings.stDev, true),
			withSpacing('Javg', spacings.jAvg, true),
			'\n',
		];

		rawOutput.push(header.join(' '));

		const filteredHops: HopType[] = [];

		for (const [i, hop] of hops.entries()) {
			if (!hop || hop.duplicate) {
				continue;
			}

			if (!hop.resolvedAddress) {
				const isEmptyUntilEnd = hops.slice(i - 1).every(h => !h.resolvedAddress || h.duplicate);
				if (hops[i - 1]?.duplicate || isEmptyUntilEnd) { // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
					continue;
				}
			}

			filteredHops.push(hop);
		}

		for (const [i, hop] of filteredHops.entries()) {
			// Index
			const sIndex = withSpacing(String(i + 1), spacings.index, true);

			// Asn
			const sAsn = withSpacing((hop.asn.length > 0 ? `AS${hop.asn.join(' ')}` : 'AS???'), spacings.asn);

			// Hostname
			const sHostnameAlias = i === 0 ? '_gateway' : hop.resolvedHostname ?? hop.resolvedAddress;
			const sHostname = withSpacing((hop.resolvedAddress ? `${sHostnameAlias ?? ''} (${hop.resolvedAddress ?? ''})` : '(waiting for reply)'), spacings.hostname);

			// Stats
			const loss = withSpacing(((hop.stats.drop / hop.stats.total) * 100).toFixed(1), spacings.loss, true);
			const drop = withSpacing(hop.stats.drop, spacings.drop, true);
			const rcv = withSpacing((hop.stats.rcv), spacings.rcv, true);
			const avg = withSpacing(hop.stats.avg.toFixed(1), spacings.avg, true);
			const stDev = withSpacing(hop.stats.stDev.toFixed(1), spacings.stDev, true);
			const jAvg = withSpacing(hop.stats.jAvg.toFixed(1), spacings.jAvg, true);

			let line = `${sIndex}. ${sAsn} ${sHostname} `;

			if (hop.resolvedAddress) {
				line += `${loss}% ${drop} ${rcv} ${avg} ${stDev} ${jAvg}`;
			}

			line += '\n';

			rawOutput.push(line);
		}

		return rawOutput.join('');
	},

	rawParse(data: string, isFinalResult?: boolean): HopType[] {
		const sData = data.split(NEW_LINE_REG_EXP);

		let hops = [];
		let addressToHostname = new Map();

		for (const row of sData) {
			const [action, index, ...value] = row.split(' ');

			if (!action || !index || !value) {
				continue;
			}

			const entry: HopType = {
				...getInitialHopState(),
				...hops[Number(index)],
			};

			switch (action) {
				case 'h': {
					const [resolvedAddress] = value;
					const previousHostMatch = hops.find((h: HopType, hIndex: number) => h.resolvedAddress === resolvedAddress && hIndex < Number(index));

					if (!resolvedAddress) {
						break;
					}

					entry.resolvedAddress = resolvedAddress;
					entry.duplicate = Boolean(previousHostMatch);
					break;
				}

				case 'd': {
					const [resolvedHostname] = value;

					if (!resolvedHostname) {
						break;
					}

					entry.resolvedHostname = resolvedHostname;
					addressToHostname.set(entry.resolvedAddress, resolvedHostname);
					break;
				}

				case 'x': {
					const [seq] = value;
					const timeEntry = entry.timings.find(t => t.seq === seq);

					if (!seq || timeEntry) {
						break;
					}

					entry.timings.push({seq, rtt: null});
					break;
				}

				case 'p': {
					const [rtt, seq] = value;

					const timesArray = entry.timings.map(t => t.seq === seq
						? {...t, rtt: Number(rtt) / 1000}
						: t,
					);

					entry.timings = timesArray ?? [];
					break;
				}

				default: {
					break;
				}
			}

			entry.stats = MtrParser.hopStatsParse(entry, isFinalResult);
			hops[Number(index)] = entry;
		}
		
		hops = MtrParser.fulfillMissingHostnames(addressToHostname, hops);

		hops = hops.filter(({duplicate}) => duplicate !== true);

		return isFinalResult ? MtrParser.hopFinalParse(hops) : hops;
	},

	fulfillMissingHostnames(addressToHostname: Map<string, string>, hops: HopType[]): HopType[] {
		for (const hop of hops) {
			if (!hop.resolvedHostname || hop.resolvedHostname === hop.resolvedAddress) {
				const sameAddressHostname = addressToHostname.get(hop.resolvedAddress!);
				if (sameAddressHostname) {
					hop.resolvedHostname = sameAddressHostname;
				}
			}
		};
		
		return hops;
	},

	hopFinalParse(hops: HopType[]): HopType[] {
		for (const hop of hops) {
			for (const t of hop.timings) {
				delete t.seq;
			}
		}

		return hops;
	},

	hopStatsParse(hop: HopType, finalCount?: boolean): HopStatsType {
		const stats: HopStatsType = {...getInitialHopState().stats};

		if (hop.timings.length === 0) {
			return stats;
		}

		stats.total = hop.timings.length;

		const timesArray = hop.timings.filter(t => t.rtt).map(t => t.rtt) as number[];
		if (timesArray.length > 0) {
			stats.min = Math.min(...timesArray);
			stats.max = Math.max(...timesArray);
			stats.avg = roundNumber(timesArray.reduce((a, b) => a + b, 0) / timesArray.length);
			stats.stDev = roundNumber(Math.sqrt(timesArray.map(x => (x - stats.avg) ** 2).reduce((a, b) => a + b, 0) / timesArray.length));
		}

		stats.rcv = 0;
		stats.drop = 0;

		for (let i = 0; i < hop.timings.length; i++) {
			const rtt = hop.timings[i];

			if (i === (hop.timings.length - 1) && !finalCount) {
				continue;
			}

			if (rtt?.rtt) {
				stats.rcv++;
			} else {
				stats.drop++;
			}
		}

		stats.loss = roundNumber((stats.drop / stats.total) * 100);

		// Jitter
		const jitterArray = [];

		let jI = 0;
		while (jI < timesArray.length) {
			const diff = Math.abs((timesArray[jI] ?? 0) - (timesArray[jI + 1] ?? 0));
			jitterArray.push(diff);

			jI += 2;
		}

		if (jitterArray.length > 0) {
			stats.jMin = roundNumber(Math.min(...jitterArray));
			stats.jMax = roundNumber(Math.max(...jitterArray));
			stats.jAvg = roundNumber(jitterArray.reduce((a, b) => a + b, 0) / jitterArray.length);
		}

		return stats;
	},
};

export default MtrParser;
