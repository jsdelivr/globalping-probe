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

const arrayMinMax = array => {
	let output = array.slice(0, 2);

	for (const value of array) {
		output = [
			value < output[0] ? value : output[0],
			value > output[1] ? value : output[1],
		];
	}

	return output;
};

const arrayAvg = array => {
	const isBigInt = typeof array[0] === 'bigint';
	let total = isBigInt ? BigInt(0) : 0;

	for (const element of array) {
		total += element;
	}

	return total / (isBigInt ? BigInt(array.length) : array.length);
};

const calcPerGroup = (data, duration) => {
	let durationObject = {};

	if (duration) {
		const [min, max] = arrayMinMax(duration);
		const avg = arrayAvg(duration);

		durationObject = {
			min: `${min} ns`,
			max: `${max} ns`,
			avg: `${avg} ns`,
		};
	}

	const output = {
		memory: {},
		cpu: {},
	};

	const memKeys = Object.keys(data[0]?.mem ?? {});
	for (const key of memKeys) {
		const [min, max] = arrayMinMax(data.map(item => item.mem[key]));
		const avg = arrayAvg(data.map(item => item.mem[key]));

		output.memory = {
			...output.memory,
			min: {
				...output.memory.min,
				[key]: `${Math.round(min / 1024 / 1024)} MB`,
			},
			max: {
				...output.memory.max,
				[key]: `${Math.round(max / 1024 / 1024)} MB`,
			},
			avg: {
				...output.memory.avg,
				[key]: `${Math.round(avg / 1024 / 1024)} MB`,
			},
		};
	}

	const cpuKeys = Object.keys(data[0]?.cpu ?? {});
	for (const key of cpuKeys) {
		const [min, max] = arrayMinMax(data.map(item => item.cpu[key]));
		const avg = arrayAvg(data.map(item => item.cpu[key]));

		output.cpu = {
			...output.cpu,
			min: {
				...output.cpu.min,
				[key]: min,
			},
			max: {
				...output.cpu.max,
				[key]: max,
			},
			avg: {
				...output.cpu.avg,
				[key]: avg,
			},
		};
	}

	return {
		samples: data.length,
		memory: output.memory,
		cpu: output.cpu,
		...(duration ? {duration: durationObject} : {}),
	};
};

const calculateResult = data => {
	const output = {};

	const bReadings = [];
	const startIndexList = [];

	for (const l of data) {
		if (l.type === 'benchmark' && l.action === 'report') {
			bReadings.push(l);
		}

		if (l.action === 'start') {
			startIndexList.push(l);
		}
	}

	output.total = calcPerGroup(bReadings);

	const testGroups = {};
	const individualActions = {};
	for (let z = 0; z < startIndexList.length; z++) {
		const entry = startIndexList[z];

		const entryIndexObject = {
			start: -1,
			end: -1,
		};

		for (const [i, l] of data.entries()) {
			if (l.id === entry.id) {
				if (l.action === 'start') {
					entryIndexObject.start = i;
				}

				if (l.action === 'end') {
					entryIndexObject.end = i;
				}
			}
		}

		if (entryIndexObject.end !== -1) {
			const group = [];

			const sampleArray = data.slice(entryIndexObject.start, entryIndexObject.end);
			for (let i = 0; i < sampleArray.length; i++) {
				const l = data[i];

				if (l.type === 'benchmark' && l.action === 'report') {
					group.push(l);
				}
			}

			const duration = BigInt(data[entryIndexObject.end].date) - BigInt(data[entryIndexObject.start].date);

			console.log(`${z} / ${startIndexList.length}`, entry);
			testGroups[entry.id] = {
				type: entry.type,
				data: group,
				duration,
			};

			individualActions[entry.id] = {
				type: entry.type,
				data: calcPerGroup(group),
				duration: `${duration.toString} ns`,
			};
		}
	}

	const totalActions = {};
	const testGroupValuesByType = Object.values(_.groupBy(testGroups, 'type'));
	for (const list of testGroupValuesByType) {
		const dataList = [];
		const durationList = [];

		for (const g of list) {
			dataList.push(g.data);
			durationList.push(BigInt(g.duration));
		}

		totalActions[list[0].type] = calcPerGroup(dataList.flat(), durationList);
	}

	output.actions = {
		total: totalActions,
		individual: individualActions,
	};

	return output;
};

const fileContent = await resolveFile();
const result = calculateResult(fileContent);
saveResult(result);
