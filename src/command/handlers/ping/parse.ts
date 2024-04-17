type PingStats = {
	min?: number;
	max?: number;
	avg?: number;
	total?: number;
	loss?: number;
	rcv?: number;
	drop?: number;
};

type PingTimings = {
	ttl: number;
	rtt: number;
};

export type PingParseOutput = {
	status: 'finished' | 'failed';
	rawOutput: string;
	resolvedHostname?: string;
	resolvedAddress?: string;
	timings?: PingTimings[];
	stats?: PingStats;
};

export default function parse (rawOutput: string): PingParseOutput {
	const lines = rawOutput.split('\n');

	if (lines.length === 0) {
		return { status: 'failed', rawOutput };
	}

	const header = /^PING\s(?<host>.*?)\s\((?<addr>.+?)\)/.exec(lines[0] ?? '');

	if (!header) {
		return { status: 'failed', rawOutput };
	}

	const resolvedAddress = String(header?.groups?.['addr']);
	const timeLines = lines.slice(1).map(l => parseStatsLine(l)).filter(Boolean) as PingTimings[];

	const resolvedHostname = (/(?<=from\s).*?(?=\s)/.exec((lines[1] ?? '')))?.[0];
	const summaryHeaderIndex = lines.findIndex(l => /^---\s(.*)\sstatistics ---/.test(l));
	const summary = parseSummary(lines.slice(summaryHeaderIndex + 1));

	return {
		status: 'finished',
		resolvedAddress,
		resolvedHostname: resolvedHostname ?? '',
		timings: timeLines,
		stats: summary,
		rawOutput,
	};
}

function parseStatsLine (line: string): PingTimings | undefined {
	const parsed = /^\d+ bytes from (?<host>.*?)( \(.*\))?: (?:icmp_)?seq=\d+ ttl=(?<ttl>\d+) time=(?<time>\d*(?:\.\d+)?) ms/.exec(line);

	if (!parsed?.groups) {
		return;
	}

	return {
		ttl: Number.parseInt(parsed.groups['ttl'] ?? '-1', 10),
		rtt: Number.parseFloat(parsed.groups['time'] ?? '-1'),
	};
}

function parseSummary (lines: string[]): PingStats {
	const [ packets, rtt ] = lines;
	const stats: PingStats = {};

	if (rtt) {
		const rttMatch = /^(?:round-trip|rtt)\s.*\s=\s(?<min>\d*(?:\.\d+)?)\/(?<avg>\d*(?:\.\d+)?)\/(?<max>\d*(?:\.\d+)?)?/.exec(rtt);

		stats.min = Number.parseFloat(rttMatch?.groups?.['min'] ?? '');
		stats.avg = Number.parseFloat(rttMatch?.groups?.['avg'] ?? '');
		stats.max = Number.parseFloat(rttMatch?.groups?.['max'] ?? '');
	}

	if (packets) {
		const packetsMatch = /(?<total>\d+)\spackets\stransmitted,\s(?<rcv>\d+)\s(received|packets received),\s(?<loss>\d*(?:\.\d+)?)%\spacket\sloss/.exec(packets);
		stats.total = Number.parseInt(packetsMatch?.groups?.['total'] ?? '-1', 10);
		stats.loss = Number.parseFloat(packetsMatch?.groups?.['loss'] ?? '-1');
		stats.rcv = Number.parseInt(packetsMatch?.groups?.['rcv'] ?? '-1', 10);
		stats.drop = stats.total - stats.rcv;
	}

	return stats;
}
