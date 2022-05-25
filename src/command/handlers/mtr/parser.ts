import type {
	HopStatsType,
	HopType,
} from './types.js';

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

// eslint-disable-next-line @typescript-eslint/naming-convention
export const MtrParser = {
	outputBuilder(hops: HopType[]): string {
		let rawOutput = 'Host - Loss% Drop Rcv Avg stDev jAvg\n';

		for (const [i, hop] of hops.entries()) {
			if (!hop) {
				continue;
			}

			const hostname = hop.host ? `${hop.host} (${hop.resolvedHost ?? ''})` : '(waiting for reply)';
			const loss = ((hop.stats.drop / hop.stats.total) * 100).toFixed(1);
			const rcv = hop.stats.total - hop.stats.drop;
			const avg = hop.stats.avg.toFixed(1);
			const stDev = hop.stats.stDev.toFixed(1);
			const jAvg = hop.stats.jAvg.toFixed(1);

			let sHop = `${i + 1}. ${hostname} `;

			if (hop.host) {
				sHop += `${loss}% ${hop.stats.drop} ${rcv} ${avg} ${stDev} ${jAvg}`;
			}

			sHop += '\n';

			rawOutput += sHop;
		}

		return rawOutput;
	},

	hopsParse(currentHops: HopType[], data: string, isFinalResult?: boolean): HopType[] {
		const sData = data.split('\n');

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

		stats.min = Math.min(...timesArray);
		stats.max = Math.max(...timesArray);
		stats.avg = timesArray.reduce((a, b) => a + b, 0) / timesArray.length;
		stats.total = hop.times.length;
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

		stats.stDev = Math.sqrt(timesArray.map(x => (x - stats.avg) ** 2).reduce((a, b) => a + b, 0) / timesArray.length);

		// Jitter
		const jitterArray = [];

		let jI = 0;
		while (jI < timesArray.length) {
			const diff = Math.abs((timesArray[jI] ?? 0) - (timesArray[jI + 1] ?? 0));
			jitterArray.push(diff);

			jI += 2;
		}

		stats.jMin = Math.min(...jitterArray);
		stats.jMax = Math.max(...jitterArray);
		stats.jAvg = jitterArray.reduce((a, b) => a + b, 0) / jitterArray.length;

		return stats;
	},

};

export default MtrParser;
