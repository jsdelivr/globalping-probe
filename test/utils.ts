import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import * as sinon from 'sinon';
import { fileURLToPath } from 'node:url';
import * as util from 'node:util';
import { expect } from 'chai';
import _ from 'lodash';
import stringifyObject from 'stringify-object';
import wrapItPlugin from './plugins/wrap-it/index.js';

import type { ExecaChildProcess } from 'execa';
import type { CommandInterface } from '../src/types.js';
import type { SinonStubbedInstance } from 'sinon';
import type { Socket } from 'socket.io-client';

export const getCmdMock = (name: string): string => readFileSync(path.resolve(`./test/mocks/${name}.txt`)).toString();
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
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	execaMock.resolve = res;
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	execaMock.reject = rej;
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	execaMock.kill = sinon.stub();

	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
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
