import * as path from 'node:path';
import {readFileSync} from 'node:fs';

export const getCmdMock = (name: string): string => readFileSync(path.resolve(`./test/mocks/${name}.txt`)).toString();
export const getCmdMockResult = (name: string): unknown => JSON.parse(readFileSync(path.resolve(`./test/mocks/${name}.json`)).toString());
