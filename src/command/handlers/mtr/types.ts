export type HopTimesType = {
	seq?: string;
	rtt?: number;
};

export type HopStatsType = {
	min: number;
	max: number;
	avg: number;
	total: number;
	loss: number;
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

export type ProgressType = {
	rawOutput: string;
};

export type ResultType = {
	status: 'finished' | 'failed';
	resolvedAddress?: string;
	resolvedHostname?: string;
	hops: HopType[];
	data: string[];
	rawOutput: string;
};

/* eslint-disable @typescript-eslint/ban-types */
export type ResultTypeJson = {
	status: 'finished' | 'failed';
	resolvedAddress: string | null;
	resolvedHostname: string | null;
	hops: Array<{
		asn: number[];
		resolvedAddress: string | null;
		resolvedHostname: string | null;
		stats: HopStatsType;
		timings: HopTimesType[];
	}>;
	rawOutput: string;
};
/* eslint-enable @typescript-eslint/ban-types */
