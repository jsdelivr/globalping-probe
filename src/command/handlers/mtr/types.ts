export type HopTimesType = {
	seq?: string;
	// eslint-disable-next-line @typescript-eslint/ban-types
	rtt: number | null;
};

export type HopStatsType = {
	min: number;
	max: number;
	avg: number;
	total: number;
	rcv: number;
	drop: number;
	stDev: number;
	jMin: number;
	jMax: number;
	jAvg: number;
};

export type HopType = {
	asn: number[];
	resolvedAddress?: string;
	resolvedHostname?: string;
	stats: HopStatsType;
	timings: HopTimesType[];
	duplicate?: boolean;
};

export type ResultType = {
	resolvedAddress?: string;
	resolvedHostname?: string;
	hops: HopType[];
	data: string[];
	rawOutput: string;
};

/* eslint-disable @typescript-eslint/ban-types */
export type ResultTypeJson = {
	resolvedAddress: string | null;
	resolvedHostname: string | null;
	hops: Array<{
		asn: number[];
		resolvedAddress: string | null;
		resolvedHostname: string | null;
		stats: HopStatsType;
		timings: HopTimesType[];
		duplicate: boolean;
	}>;
	rawOutput: string;
};
/* eslint-enable @typescript-eslint/ban-types */
