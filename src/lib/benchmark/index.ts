// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// cant be bothered with TS stupidity

import process, {hrtime} from 'node:process';
import NanoTimer from 'nanotimer';

const timer = new NanoTimer();

export const benchmark = () => {
	const cpuUsage = process.cpuUsage();
	const memUsage = process.memoryUsage();

	const result = {
		type: 'benchmark',
		action: 'report',
		mem: memUsage,
		cpu: cpuUsage,
	};

	recordOnBenchmark(result);
};

export const recordOnBenchmark = (input: unknown) => {
	const date = hrtime.bigint();
	const reading = JSON.stringify({...input, date: date.toString()});
	console.log(reading);
};

export const start = () => {
	timer.setInterval(() => {
		benchmark();
	}, null, '10n');
};

export const end = () => {
	timer.clearInterval();
};
