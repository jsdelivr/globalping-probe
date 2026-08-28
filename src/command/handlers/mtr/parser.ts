import is from '@sindresorhus/is';
import _ from 'lodash';
import { ipEquals, normalizeIp } from '../../../lib/ip.js';
import type {
	HopStatsType,
	HopType,
} from './types.js';

export const NEW_LINE_REG_EXP = /\r?\n/;

const getInitialHopState = (): HopType => ({
	stats: {
		min: null,
		max: null,
		avg: null,
		total: 0,
		loss: 0,
		rcv: 0,
		drop: 0,
		stDev: null,
		jMin: null,
		jMax: null,
		jAvg: null,
	},
	asn: [],
	timings: [],
});

const getSpacing = (length: number): string => Array.from({ length }).fill(' ').join('');
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

const formatTimingStat = (value: number | null): string => (value ?? 0).toFixed(1);

const isTargetHop = (hop: HopType, target: string): boolean => {
	return !!hop.resolvedAddress
		&& hop.timings.some(timing => timing.rtt !== undefined)
		&& ipEquals(hop.resolvedAddress, target);
};

export const MtrParser = {
	outputBuilder (hops: HopType[]): string {
		const rawOutput = [];
		const asnLabels = hops.map(hop => hop.asn.length > 0 ? `AS${hop.asn.join(' ')}` : 'AS???');
		const hostLabels = hops.map((hop, i) => {
			const hostnameAlias = i === 0 ? '_gateway' : hop.resolvedHostname ?? hop.displayAddress ?? hop.resolvedAddress;
			return hop.resolvedAddress ? `${hostnameAlias ?? ''} (${hop.displayAddress ?? hop.resolvedAddress})` : '(waiting for reply)';
		});

		const spacings = {
			index: String(hops.length).length,
			asn: Math.max(...asnLabels.map(asnLabel => asnLabel.length)),
			hostname: Math.max(...hostLabels.map(hostLabel => hostLabel.length)),
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

		for (const [ i, hop ] of hops.entries()) {
			// Index
			const sIndex = withSpacing(String(i + 1), spacings.index, true);

			// Asn
			const sAsn = withSpacing(asnLabels[i]!, spacings.asn);

			// Hostname
			const sHostname = withSpacing(hostLabels[i]!, spacings.hostname);

			// Stats
			const loss = withSpacing(((hop.stats.drop / hop.stats.total) * 100).toFixed(1), spacings.loss, true);
			const drop = withSpacing(hop.stats.drop, spacings.drop, true);
			const rcv = withSpacing((hop.stats.rcv), spacings.rcv, true);
			const avg = withSpacing(formatTimingStat(hop.stats.avg), spacings.avg, true);
			const stDev = withSpacing(formatTimingStat(hop.stats.stDev), spacings.stDev, true);
			const jAvg = withSpacing(formatTimingStat(hop.stats.jAvg), spacings.jAvg, true);

			let line = `${sIndex}. ${sAsn} ${sHostname} `;

			if (hop.resolvedAddress) {
				line += `${loss}% ${drop} ${rcv} ${avg} ${stDev} ${jAvg}`;
			}

			line += '\n';

			rawOutput.push(line);
		}

		return rawOutput.join('');
	},

	rawParse (data: string, isFinalResult?: boolean, target?: string): HopType[] {
		const sData = data.split(NEW_LINE_REG_EXP);

		let hops = [];

		for (const row of sData) {
			const [ action, index, ...value ] = row.split(' ');

			if (!action || !index || !value) {
				continue;
			}

			const entry: HopType = {
				...getInitialHopState(),
				...hops[Number(index)],
			};

			switch (action) {
				case 'h': {
					const [ rawResolvedAddress ] = value;

					if (!rawResolvedAddress) {
						break;
					}

					const scopeIndex = rawResolvedAddress.indexOf('%');
					const resolvedAddress = normalizeIp(rawResolvedAddress);
					const displayAddress = scopeIndex === -1 ? undefined : `${resolvedAddress}${rawResolvedAddress.slice(scopeIndex)}`;
					const previousHostMatch = hops.find((h: HopType, hIndex: number) => h.resolvedAddress === resolvedAddress && h.displayAddress === displayAddress && hIndex < Number(index));

					entry.resolvedAddress = resolvedAddress;

					if (displayAddress) {
						entry.displayAddress = displayAddress;
					}

					entry.duplicate = Boolean(previousHostMatch);
					break;
				}

				case 'x': {
					const [ seq ] = value;
					const timeEntry = entry.timings.find(t => t.seq === seq);

					if (!seq || timeEntry) {
						break;
					}

					entry.timings.push({ seq });
					break;
				}

				case 'p': {
					const [ rtt, seq ] = value;

					const timesArray = entry.timings.map(t => t.seq === seq
						? { ...t, rtt: Number(rtt) / 1000 }
						: t);

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

		hops = MtrParser.removeDuplicates(hops);

		hops = MtrParser.trimHops(hops, target);

		return MtrParser.hopFinalParse(hops);
	},

	trimHops (hops: HopType[], target?: string): HopType[] {
		const targetIndex = target
			? hops.findIndex(hop => isTargetHop(hop, target))
			: -1;

		if (targetIndex !== -1) {
			return hops.slice(0, targetIndex + 1);
		}

		const lastRespondingIndex = hops.reduce((last, hop, i) => hop.resolvedAddress ? i : last, -1);

		return hops.slice(0, lastRespondingIndex + 2);
	},

	removeDuplicates (hops: HopType[]): HopType[] {
		const filteredHops = hops.filter(({ duplicate }) => duplicate !== true);

		for (const hop of filteredHops) {
			delete hop.duplicate;
		}

		return filteredHops;
	},

	hopFinalParse (hops: HopType[]): HopType[] {
		for (const hop of hops) {
			for (const t of hop.timings) {
				delete t.seq;
			}

			hop.timings = hop.timings.filter(hop => !_.isEmpty(hop));
		}

		return hops;
	},

	hopStatsParse (hop: HopType, finalCount?: boolean): HopStatsType {
		const stats: HopStatsType = { ...getInitialHopState().stats };

		if (hop.timings.length === 0) {
			return stats;
		}

		stats.total = hop.timings.length;

		const timesArray = hop.timings.map(t => t.rtt).filter(is.number);

		if (timesArray.length > 0) {
			stats.min = Math.min(...timesArray);
			stats.max = Math.max(...timesArray);
			stats.avg = roundNumber(timesArray.reduce((a, b) => a + b, 0) / timesArray.length);
			stats.stDev = roundNumber(Math.sqrt(timesArray.map(x => (x - stats.avg!) ** 2).reduce((a, b) => a + b, 0) / timesArray.length));
		}

		stats.rcv = 0;
		stats.drop = 0;

		for (let i = 0; i < hop.timings.length; i++) {
			const rtt = hop.timings[i];

			if (i === (hop.timings.length - 1) && !finalCount) {
				continue;
			}

			if (rtt?.rtt === null || rtt?.rtt === undefined) {
				stats.drop++;
			} else {
				stats.rcv++;
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
