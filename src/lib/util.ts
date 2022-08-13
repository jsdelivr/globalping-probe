import cryptoRandomString from 'crypto-random-string';
import {recordOnBenchmark} from './benchmark/index.js';

/*
 * Turns promise into callback fn
 */
export const callbackify = (
	fn: (..._args: never[]) => Promise<unknown>,
	spreadResult = false,
) => (async (...args: unknown[]) => {
	const bId = cryptoRandomString({length: 16, type: 'alphanumeric'});
	recordOnBenchmark({type: 'callbackify', action: 'start', id: bId});

	const cb = args[args.length - 1] as (
		error: Error | undefined,
		result?: unknown,
		family?: number | undefined
	) => void;
	const pArgs = args.slice(0, -1) as never[];

	const result = await fn(...pArgs).catch((error: unknown) => error);

	if (result instanceof Error) {
		recordOnBenchmark({type: 'callbackify', action: 'end', id: bId});
		cb(result);
		return;
	}

	if (Array.isArray(result) && spreadResult) {
		recordOnBenchmark({type: 'callbackify', action: 'end', id: bId});
		cb(undefined, ...result);
		return;
	}

	recordOnBenchmark({type: 'callbackify', action: 'end', id: bId});
	cb(undefined, result);
}) as (...args: unknown[]) => never;

