import os from 'node:os';

export type CpuUsage = {
	usage: number;
	idle: number;
};

export type CpuUsageResponse = {
	count: number;
	load: CpuUsage[];
};

export const getCurrentCpu = (): CpuUsageResponse => {
	const cpus = os.cpus();

	const coreCount = cpus.length;
	const load = cpus.map((cpu) => {
		const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
		return {
			usage: total - cpu.times.idle,
			idle: cpu.times.idle,
		};
	});

	return {
		count: coreCount,
		load,
	};
};

export const getCpuUsage = async (): Promise<CpuUsageResponse> => {
	const startCpu = getCurrentCpu();

	const result: CpuUsageResponse = {
		count: startCpu.count,
		load: [],
	};

	await new Promise<void>((resolve) => {
		setTimeout(() => {
			const endCpu = getCurrentCpu();

			for (let i = 0; i < endCpu.load.length; i++) {
				const startLoad = startCpu.load[i]!;
				const endLoad = endCpu.load[i]!;

				const idleDiff = endLoad.idle - startLoad.idle || 0;
				const usageDiff = endLoad.usage - startLoad.usage || 0;
				const totalDiff = (endLoad.usage + endLoad.idle) - (startLoad.usage + startLoad.idle);

				result.load[i] = {
					usage: (10_000 - Math.round(10_000 * idleDiff / totalDiff)) / 100,
					idle: (10_000 - Math.round(10_000 * usageDiff / totalDiff)) / 100,
				};
			}

			resolve();
		}, 1000);
	});

	return result;
};
