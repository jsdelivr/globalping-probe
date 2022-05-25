export type HopTimesType = {
	seq: string;
	time?: number;
};

export type HopStatsType = {
	min: number;
	max: number;
	avg: number;
	total: number;
	drop: number;
	stDev: number;
	jMin: number;
	jMax: number;
	jAvg: number;
};

export type HopType = {
	host?: string;
	resolvedHost?: string;
	stats: HopStatsType;
	times: HopTimesType[];
};

export type ResultType = {
	hops: HopType[];
	rawOutput: string;
};
