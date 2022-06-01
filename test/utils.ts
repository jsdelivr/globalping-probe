import * as path from 'node:path';
import {readFileSync} from 'node:fs';

export const getCmdMock = (name: string): string => readFileSync(path.resolve(`./test/mocks/${name}.txt`)).toString();
export const getCmdMockResult = (name: string): unknown => JSON.parse(readFileSync(path.resolve(`./test/mocks/${name}.json`)).toString());

// a helper for execa return.
// stolen from https://github.com/sindresorhus/execa/blob/main/lib/promise.js
type Descriptor = {
	value: () => unknown;
	writable: boolean;
	enumerable: boolean;
	configurable: boolean;
};
type DescriptorMap = [ string, Descriptor ];

const nativePromise = Promise.resolve();
const nativePromisePrototype = nativePromise.constructor.prototype as never;
const descriptors = ['then', 'catch', 'finally'].map((property: string) => [
	property,
	Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property) as Descriptor,
]) as DescriptorMap[];

type ArgPromise = Promise<unknown> | (() => Promise<unknown>);
type ArgObject = Record<string, unknown>;

// The return value is a mixin of `childProcess` and `Promise`
export const execaPromise = (object: ArgObject, promise: ArgPromise) => {
	for (const [property, descriptor] of descriptors) {
		if (!property || typeof property !== 'string' || !descriptor || typeof descriptor !== 'object') {
			continue;
		}

		// Starting the main `promise` is deferred to avoid consuming streams
		const value = typeof promise === 'function'
			? (...args: unknown[]) => Reflect.apply(descriptor.value, promise(), args) as never
			: descriptor.value.bind(promise);

		Reflect.defineProperty(object, property, {...descriptor, value});
	}

	return object;
};
