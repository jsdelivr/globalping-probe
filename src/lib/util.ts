/*
 * Turns promise into callback fn
 */
export const callbackify = (
	fn: (..._args: never[]) => Promise<unknown>,
	spreadResult = false,
) => (async (...args: unknown[]) => {
	const cb = args[args.length - 1] as (
		error: Error | undefined,
		result?: unknown,
		family?: number | undefined
	) => void;
	const pArgs = args.slice(0, -1) as never[];

	const result = await fn(...pArgs).catch((error: unknown) => error);

	if (result instanceof Error) {
		cb(result);
		return;
	}

	if (Array.isArray(result) && spreadResult) {
		cb(undefined, ...result);
		return;
	}

	cb(undefined, result);
}) as (...args: unknown[]) => never;

