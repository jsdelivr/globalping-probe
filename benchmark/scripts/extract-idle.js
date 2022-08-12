import process from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import linebyline from 'linebyline';
import _ from 'lodash';

const testName = process.env.TEST_NAME;

const resolveFile = async () => {
	const filePath = path.resolve(`./benchmark/readings/${testName}-idle.log`);
	const rl = linebyline(filePath);

	const records = await new Promise(resolve => {
		const records = [];

		rl.on('line', l => {
			try {
				records.push(JSON.parse(l));
			} catch {
				//
			}
		});

		rl.on('end', () => {
			resolve(records);
		});
	});

	return records;
};

const saveResult = data => {
	const filePath = path.resolve(`./benchmark/output/${testName}-idle.json`);
	fs.writeFileSync(filePath, JSON.stringify(data, 0, 2));
};

const arrayMinMax = array =>
// eslint-disable-next-line unicorn/no-array-reduce
	array.reduce(([min, max], value) => [Math.min(min, value), Math.max(max, value)], [
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]);

const bigIntMinAndMax = array =>
// eslint-disable-next-line unicorn/no-array-reduce
	array.reduce(([min, max], value) => [
		value < min ? value : min,
		value > max ? value : max,
	], [array[0], array[1]]);

const calcPerGroup = (data, duration) => {
	let durationObject = {};

	if (duration) {
		const [min, max] = bigIntMinAndMax(duration);
		durationObject = {
			min: `${min} ns`,
			max: `${max} ns`,
			avg: `${duration.reduce((total, item) => total + item, 0n) / BigInt(duration.length)} ns`,
		};
	}

	return {
		samples: data.length,
		// eslint-disable-next-line unicorn/no-array-reduce
		memory: Object.keys(data[0]?.mem ?? {}).reduce((acc, key) => {
			const [min, max] = arrayMinMax(data.map(item => item.mem[key]));

			const avg = data.reduce((total, item) => total + item.mem[key], 0) / data.length;

			return {
				...acc,
				min: {
					...acc.min,
					[key]: `${Math.round(min / 1024 / 1024)} MB`,
				},
				max: {
					...acc.max,
					[key]: `${Math.round(max / 1024 / 1024)} MB`,
				},
				avg: {
					...acc.avg,
					[key]: `${Math.round(avg / 1024 / 1024)} MB`,
				},
			};
		}, {}),
		// eslint-disable-next-line unicorn/no-array-reduce
		cpu: Object.keys(data[0]?.cpu ?? {}).reduce((acc, key) => {
			const [min, max] = arrayMinMax(data.map(item => item.cpu[key]));

			return {
				...acc,
				min: {
					...acc.min,
					[key]: min,
				},
				max: {
					...acc.max,
					[key]: max,
				},
				avg: {
					...acc.avg,

					[key]: Math.round(data.reduce((total, item) => total + item.cpu[key], 0) / data.length),
				},
			};
		}, {}),
		...(duration ? {duration: durationObject} : {}),
	};
};

const calculateResult = data => {
	const output = {};

	// Total duration
	const bReadings = data.filter(l => l.type === 'benchmark' && l.action === 'report');
	output.total = calcPerGroup(bReadings);

	// Start indexes
	const startIndexList = data.filter(l => l.action === 'start');
	// eslint-disable-next-line unicorn/no-array-reduce
	const testGroups = startIndexList.reduce((acc, entry) => {
		const startEntryIndex = data.findIndex(l => l.id === entry.id && l.action === 'start');
		const endEntryIndex = data.findIndex(l => l.id === entry.id && l.action === 'end');

		if (endEntryIndex === -1) {
			return acc;
		}

		const group = data.slice(startEntryIndex, endEntryIndex).filter(l => l.type === 'benchmark' && l.action === 'report');
		const duration = BigInt(data[endEntryIndex].date) - BigInt(data[startEntryIndex].date);

		console.log(entry);
		return {
			...acc,
			[entry.id]: {
				type: entry.type,
				data: group,
				duration,
			},
		};
	}, {});

	// eslint-disable-next-line unicorn/no-array-reduce
	const individualActions = Object.keys(testGroups).reduce((acc, key) => {
		const item = testGroups[key];
		return {
			...acc,
			[key]: {
				type: item.type,
				duration: `${item.duration.toString()} ns`,
				data: calcPerGroup(item.data),
			},
		};
	}, {});

	// eslint-disable-next-line unicorn/no-array-reduce
	const totalActions = Object.values(_.groupBy(testGroups, 'type')).reduce((acc, entry) => {
		const group = entry.map(g => g.data);
		const duration = entry.map(g => BigInt(g.duration));

		return {
			...acc,
			[entry[0].type]: calcPerGroup(group.flat(), duration),
		};
	}, {});

	output.actions = {
		total: totalActions,
		individual: individualActions,
	};

	return output;
};

const fileContent = await resolveFile();
const result = calculateResult(fileContent);
saveResult(result);