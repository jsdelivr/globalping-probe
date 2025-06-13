import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import * as sinon from 'sinon';
import { fileURLToPath } from 'node:url';
import * as util from 'node:util';
import { expect } from 'chai';
import config from 'config';
import _ from 'lodash';
import { SinonSandboxConfig, SinonStubbedInstance } from 'sinon';
import stringifyObject from 'stringify-object';
import wrapItPlugin from './plugins/wrap-it/index.js';

import type { ExecaChildProcess } from 'execa';
import type { CommandInterface } from '../src/types.js';
import type { Socket } from 'socket.io-client';

const progressIntervalTime = config.get<number>('commands.progressInterval');

export const getCmdMock = (name: string): string => readFileSync(path.resolve(`./test/mocks/${name}.txt`)).toString().replace(/\r?\n$/, '');
export const getCmdMockResult = (name: string) => JSON.parse(readFileSync(path.resolve(`./test/mocks/${name}.json`)).toString()) as Record<string, unknown>;

export class MockSocket extends EventEmitter {
	override emit (event: string, data?: any, callback?: () => void) {
		super.emit(event, data);

		if (callback) {
			callback();
		}

		return true;
	}

	connect () {
		// Empty connect method, that will be overridden with stub in tests
	}

	disconnect () {
		// Empty disconnect method, that will be overridden with stub in tests
	}
}

type ExecaMock = Promise<any> & {
	resolve: (data: any) => void;
	reject: (error: any) => void;
	kill: sinon.SinonStub;
	stdout: EventEmitter;
};

export const getExecaMock = () => {
	let res;
	let rej;
	const execaMock = new Promise((resolve, reject) => {
		res = resolve;
		rej = reject;
	}) as ExecaMock & ExecaChildProcess;

	execaMock.resolve = res;

	execaMock.reject = rej;

	execaMock.kill = sinon.stub();

	// @ts-expect-error TS error expected.
	execaMock.stdout = new EventEmitter();
	return execaMock;
};

const cartesian = (...sets: any[]) => {
	if (sets.length === 1) {
		return sets[0].map((i: any) => [ i ]);
	}

	return sets.reduce((accumulator, currentSet) => {
		return accumulator.flatMap((resultItem: any) => {
			return currentSet.map((currentSetItem: any) => [ resultItem, currentSetItem ].flat());
		});
	});
};

type SnapshotTestOptions = {
	note?: string;
};

export const wrapIt = wrapItPlugin;

export const makeSnapshotTests = <T> (tester: CommandTester<T>, testTemplate: any, { note }: SnapshotTestOptions = {}) => {
	const templateKeys = Object.keys(testTemplate);
	const templateValues = Object.values(testTemplate).map(item => Array.isArray(item) ? item : [ item ]);
	const testCases = cartesian(...templateValues).map((test: unknown[]) => _.zipObject(templateKeys, test));

	testCases.forEach((testCase: T) => {
		it(util.format(`should work with ${stringifyObject(testCase, { inlineCharacterLimit: Infinity })}${note ? ` - ${note}` : ''}`), async () => {
			await tester.execute(testCase);
		});
	});
};

export class CommandTester<TOptions> {
	constructor (
		private readonly fn: (cmd: (options: TOptions) => any) => CommandInterface<TOptions>,
		private readonly cmd: (options: TOptions) => any,
		private readonly socket: SinonStubbedInstance<Socket<any, any>>,
	) {
	}

	async execute (options: TOptions) {
		const payloadSnapshotName = `${global.currentTestTitle}: payload`;
		const resultSnapshotName = `${global.currentTestTitle}: result`;

		await this.fn((validatedOptions) => {
			const snapshot = global.chaiSnapshotInstance.getSnapshot(payloadSnapshotName);

			if (snapshot) {
				const mockCmd = getExecaMock();
				mockCmd.resolve({ ...snapshot });
				return mockCmd;
			}

			const execa = this.cmd(validatedOptions);

			// eslint-disable-next-line promise/catch-or-return
			execa.then((result: any) => {
				global.chaiSnapshotInstance.snapshot(payloadSnapshotName, result);
			});

			return execa;
		}).run(this.socket, '', '', options);

		expect(this.socket.emit.lastCall.args).to.matchTestSnapshot(resultSnapshotName);
	}
}

export const setupSnapshots = (url: string) => {
	const file = fileURLToPath(url);
	const directory = path.dirname(fileURLToPath(import.meta.url));

	global.chaiSnapshotInstance.setCurrentFile(path.join(
		directory,
		'snapshots',
		path.relative(directory, path.dirname(file)).split(path.sep).slice(1).join(path.sep),
		`${path.basename(file, path.extname(file))}.json`,
	));
};

export const chunkOutput = (rawOutput: string) => {
	const lineCount = rawOutput.match(/\n/g)?.length ?? 0;
	const maxPerChunk = lineCount > 20 ? 5 : 2;
	const lines = rawOutput.trimEnd().match(new RegExp(`^.*?\n|(?:.*?\n){1,${maxPerChunk}}|.+$`, 'g'));
	const linesChunks = lines.map((chunk, index) => {
		if (!index) {
			return [ chunk ];
		}

		const half = Math.round(chunk.length / 2);

		return [
			chunk.slice(0, half),
			chunk.slice(half),
		];
	});

	return {
		lines,
		async emitChunks (stream: EventEmitter) {
			for (const lineChunks of linesChunks) {
				for (const chunk of lineChunks) {
					stream.emit('data', Buffer.from(chunk, 'utf8'));
				}

				await new Promise(resolve => setTimeout(resolve, progressIntervalTime * 2));
			}

			stream.emit('end');
			await new Promise(resolve => setTimeout(resolve, progressIntervalTime * 2));
		},
		verifyChunks (socket: SinonStubbedInstance<Socket<any, any>>, expectedChunks: string[] = lines) {
			for (let i = 0; i < expectedChunks.length; i++) {
				expect(socket.emit.args[i], `emit [${i}]`).to.deep.equal([ 'probe:measurement:progress', {
					testId: 'test',
					measurementId: 'measurement',
					overwrite: false,
					result: { rawOutput: expectedChunks[i] },
				}]);
			}

			expect(socket.emit.callCount).to.equal(expectedChunks.length + 1);
		},
	};
};

export const chunkObjectStream = (rawOutput: string) => {
	const lines: string[] = rawOutput.trimEnd().match(/.*?\n|.+$/g) || [];

	return {
		lines,
		async emitChunks (callback: (chunk: any) => void) {
			for (const line of lines) {
				callback(JSON.parse(line));
				await new Promise(resolve => setTimeout(resolve, progressIntervalTime * 2));
			}

			await new Promise(resolve => setTimeout(resolve, progressIntervalTime * 2));
		},
		verifyChunks (socket: SinonStubbedInstance<Socket<any, any>>, expectedChunks: string[] = lines) {
			for (let i = 0; i < expectedChunks.length; i++) {
				expect(socket.emit.args[i], `emit [${i}]`).to.deep.equal([ 'probe:measurement:progress', {
					testId: 'test',
					measurementId: 'measurement',
					overwrite: false,
					result: { rawOutput: expectedChunks[i] },
				}]);
			}

			expect(socket.emit.callCount).to.equal(expectedChunks.length + 1);
		},
	};
};

export const useSandboxWithFakeTimers = (config: Partial<SinonSandboxConfig> = {}) => {
	return sinon.createSandbox({
		...config,
		useFakeTimers: {
			..._.isObject(config.useFakeTimers) ? config.useFakeTimers : {},
			// Avoid overriding hrtime, performance, and other advanced APIs as it causes problems with other modules.
			toFake: [ 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date' ],
		},
	});
};
