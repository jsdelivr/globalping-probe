import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import {readFileSync} from 'node:fs';

export const getCmdMock = (name: string): string => readFileSync(path.resolve(`./test/mocks/${name}.txt`)).toString();
export const getCmdMockProgress = (name: string): string[] => JSON.parse(readFileSync(path.resolve(`./test/mocks/${name}-progress.json`)).toString());
export const getCmdMockResult = (name: string): Object => JSON.parse(readFileSync(path.resolve(`./test/mocks/${name}.json`)).toString());

export class MockSocket extends EventEmitter {
	override emit(event: string, data?: any, callback?: Function) {
		super.emit(event, data);
		callback && callback();
		return true;
	}

	connect () {}

	disconnect () {}
}

export const getExecaMock = () => {
	let resolve, reject;
	const execaMock = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	}) as Promise<any> & {resolve: Function, reject: Function, kill: Function, stdout: EventEmitter};
	execaMock.resolve = resolve;
	execaMock.reject = reject;
	execaMock.kill = () => {};
	execaMock.stdout = new EventEmitter();
	return execaMock;
};
