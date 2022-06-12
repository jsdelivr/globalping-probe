import type {
	HopStatsType,
	HopType,
} from './types.js';

/* eslint-disable @typescript-eslint/naming-convention */
export const NEW_LINE_REG_EXP = /\r?\n/;
/* eslint-enable @typescript-eslint/naming-convention */

const getInitialHopState = () => ({
	stats: {
		min: 0,
		max: 0,
		avg: 0,
		total: 0,
		drop: 0,
		stDev: 0,
		jMin: 0,
		jMax: 0,
		jAvg: 0,
	},
	times: [],
});

const getSpacing = (length: number): string => Array.from({length}).fill(' ').join('');
const withSpacing = (string_: string | number, dSpacing: number, left = false): string => {
	const sSpacing = getSpacing(dSpacing - String(string_).length);

	if (left) {
		return `${sSpacing}${string_}`;
	}

	return `${string_}${sSpacing}`;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const MtrParser = {
	outputBuilder(hops: HopType[]): string {
		const rawOutput = [];

		const spacings = {
			index: String(hops.length).length,
			asn: 2 + Math.max(...hops.map(h => String(h?.asn ?? '').length)),
			hostname: (3
        + Math.max(...hops.map(h => String(h?.host ?? '').length))
        + Math.max(...hops.map(h => String(h?.resolvedHost ?? '').length))
			),
			loss: 6,
			drop: Math.max(4, ...hops.map(h => String(h?.stats?.drop ?? '').length)),
			avg: Math.max(...hops.map(h => String(h?.stats?.avg ?? '').length)),
			rcv: 2 + Math.max(...hops.map(h => String(h?.stats?.drop ?? '').length)),
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

		for (const [i, hop] of hops.entries()) {
			if (!hop) {
				continue;
			}

			// Index
			const sIndex = withSpacing(String(i + 1), spacings.index, true);

			// Asn
			const sAsn = withSpacing((hop.asn ? `AS${hop.asn}` : 'AS???'), spacings.asn);

			// Hostname
			const sHostnameAlias = i === 0 ? '_gateway' : hop.resolvedHost ?? hop.host;
			const sHostname = withSpacing((hop.host ? `${sHostnameAlias ?? ''} (${hop.host ?? ''})` : '(waiting for reply)'), spacings.hostname);

			// Stats
			const loss = withSpacing(((hop.stats.drop / hop.stats.total) * 100).toFixed(1), spacings.loss, true);
			const drop = withSpacing(hop.stats.drop, spacings.drop, true);
			const rcv = withSpacing((hop.stats.total - hop.stats.drop), spacings.rcv, true);
			const avg = withSpacing(hop.stats.avg.toFixed(1), spacings.avg, true);
			const stDev = withSpacing(hop.stats.stDev.toFixed(1), spacings.stDev, true);
			const jAvg = withSpacing(hop.stats.jAvg.toFixed(1), spacings.jAvg, true);

			let line = `${sIndex}. ${sAsn} ${sHostname} `;

			if (hop.host) {
				line += `${loss}% ${drop} ${rcv} ${avg} ${stDev} ${jAvg}`;
			}

			line += '\n';

			rawOutput.push(line);
		}

		return rawOutput.join('');
	},

	hopsParse(currentHops: HopType[], data: string, isFinalResult?: boolean): HopType[] {
		const sData = data.split(NEW_LINE_REG_EXP);

		const hops = [...currentHops];

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
					const [host] = value;

					if (!host) {
						break;
					}

					entry.host = host;
					break;
				}

				case 'd': {
					const [host] = value;

					if (!host) {
						break;
					}

					entry.resolvedHost = host;
					break;
				}

				case 'x': {
					const [seq] = value;

					if (!seq) {
						break;
					}

					entry.times.push({seq});
					break;
				}

				case 'p': {
					const [time, seq] = value;

					const timesArray = entry.times.map(t => t.seq === seq
						? {...t, time: Number(time) / 1000}
						: t,
					);

					entry.times = timesArray ?? [];
					break;
				}

				default:
					break;
			}

			entry.stats = MtrParser.hopStatsParse(entry, isFinalResult);

			hops[Number(index)] = entry;
		}

		return hops;
	},

	hopStatsParse(hop: HopType, finalCount?: boolean): HopStatsType {
		const stats: HopStatsType = {...getInitialHopState().stats};

		if (hop.times.length === 0) {
			return stats;
		}

		const timesArray = hop.times.filter(t => t.time).map(t => t.time) as number[];

		if (timesArray.length > 0) {
			stats.min = Math.min(...timesArray);
			stats.max = Math.max(...timesArray);
			stats.avg = Number.parseFloat((timesArray.reduce((a, b) => a + b, 0) / timesArray.length).toFixed(1));
			stats.total = hop.times.length;
			stats.stDev = Number.parseFloat((Math.sqrt(timesArray.map(x => (x - stats.avg) ** 2).reduce((a, b) => a + b, 0) / timesArray.length)).toFixed(1));
		}

		stats.drop = 0;

		for (let i = 0; i < hop.times.length; i++) {
			const rtt = hop.times[i];

			if (i === (hop.times.length - 1) && !finalCount) {
				continue;
			}

			if (!rtt?.time) {
				stats.drop++;
			}
		}

		// Jitter
		const jitterArray = [];

		let jI = 0;
		while (jI < timesArray.length) {
			const diff = Math.abs((timesArray[jI] ?? 0) - (timesArray[jI + 1] ?? 0));
			jitterArray.push(diff);

			jI += 2;
		}

		if (jitterArray.length > 0) {
			stats.jMin = Math.min(...jitterArray);
			stats.jMax = Math.max(...jitterArray);
			stats.jAvg = Number.parseFloat((jitterArray.reduce((a, b) => a + b, 0) / jitterArray.length).toFixed(1));
		}

		return stats;
	},
};

export default MtrParser;
