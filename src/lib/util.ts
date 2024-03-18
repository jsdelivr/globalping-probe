import os from 'node:os';

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
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		cb(undefined, ...result);
		return;
	}

	cb(undefined, result);
}) as (...args: unknown[]) => never;

export const isV1HardwareDevice = () => {
	const cpus = os.cpus();

	return cpus.length === 4
		&& cpus.every(cpu => cpu.model === 'ARMv7 Processor rev 5 (v7l)')
		&& /^globalping-probe-\w{4}$/.test(os.hostname())
		&& os.totalmem() < 550 * 1e6;
};
