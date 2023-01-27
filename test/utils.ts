import {EventEmitter} from 'node:events';
import * as path from 'node:path';
import {readFileSync} from 'node:fs';

export const getCmdMock = (name: string): string => readFileSync(path.resolve(`./test/mocks/${name}.txt`)).toString();
export const getCmdMockResult = (name: string) => JSON.parse(readFileSync(path.resolve(`./test/mocks/${name}.json`)).toString()) as Record<string, unknown>;

export class MockSocket extends EventEmitter {
	override emit(event: string, data?: any, callback?: () => void) {
		super.emit(event, data);
		if (callback) {
			callback();
		}

		return true;
	}

	connect() {
		// Empty connect method, that will be overridden with stub in tests
	}

	disconnect() {
		// Empty disconnect method, that will be overridden with stub in tests
	}
}

type ExecaMock = Promise<any> & {
	resolve: (data: any) => void;
	reject: (error: any) => void;
	kill: () => void;
	stdout: EventEmitter;
};

export const getExecaMock = () => {
	let resolve;
	let reject;
	const execaMock = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	}) as ExecaMock;
	execaMock.resolve = resolve;
	execaMock.reject = reject;
	execaMock.kill = () => {
		// Empty kill method, that will be overriden with stub in tests
	};

	execaMock.stdout = new EventEmitter();
	return execaMock;
};
