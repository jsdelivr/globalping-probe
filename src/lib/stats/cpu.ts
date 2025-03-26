import os from 'node:os';

export type CpuUsageInternal = {
	load: Array<{
		usage: number;
		idle: number;
	}>
};

export type CpuUsageResponse = {
	load: Array<{
		usage: number;
	}>;
};

const getCurrentCpu = (): CpuUsageInternal => {
	const cpus = os.cpus();

	const load = cpus.map((cpu) => {
		const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);

		return {
			usage: total - cpu.times.idle,
			idle: cpu.times.idle,
		};
	});

	return {
		load,
	};
};

export const getCpuUsage = async (): Promise<CpuUsageResponse> => {
	const startCpu = getCurrentCpu();

	const result: CpuUsageResponse = {
		load: [],
	};

	await new Promise<void>((resolve) => {
		setTimeout(() => {
			const endCpu = getCurrentCpu();

			for (let i = 0; i < endCpu.load.length; i++) {
				const startLoad = startCpu.load[i]!;
				const endLoad = endCpu.load[i]!;

				const idleDiff = endLoad.idle - startLoad.idle || 0;
				const totalDiff = (endLoad.usage + endLoad.idle) - (startLoad.usage + startLoad.idle);

				const usage = totalDiff === 0 ? 0 : (10_000 - Math.round(10_000 * idleDiff / totalDiff)) / 100;
				result.load[i] = { usage };
			}

			resolve();
		}, 1000);
	});

	return result;
};
