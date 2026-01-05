import os from 'node:os';
import { execSync } from 'node:child_process';

/*
 * Turns promise into callback fn
 */
export const callbackify = (
	fn: (..._args: never[]) => Promise<unknown>,
	spreadResult = false,
) => (async (...args: unknown[]) => {
	const cb = args[args.length - 1] as (
		error: Error | null,
		result?: unknown,
		family?: number
	) => void;
	const pArgs = args.slice(0, -1) as never[];

	const result = await fn(...pArgs).catch((error: unknown) => error);

	if (result instanceof Error) {
		cb(result);
		return;
	}

	if (Array.isArray(result) && spreadResult) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		cb(null, ...result);
		return;
	}

	cb(null, result);
}) as (...args: unknown[]) => never;

export const getAvailableDiskSpace = () => {
	try {
		return parseInt(execSync('df --block-size=MB --output=avail / | tail -1').toString());
	} catch (e) {
		console.error(e);
		return 0;
	}
};

export const getTotalDiskSize = () => {
	try {
		return parseInt(execSync('df --block-size=MB --output=size / | tail -1').toString());
	} catch (e) {
		console.error(e);
		return 0;
	}
};

export const looksLikeV1HardwareDevice = () => {
	const cpus = os.cpus();

	return cpus.length === 4
		&& cpus.every(cpu => cpu.model === 'ARMv7 Processor rev 5 (v7l)')
		&& /^globalping-probe-\w{4}$/.test(os.hostname())
		&& os.totalmem() < 550 * 1e6;
};

export function pluralize (singular: string, count: number): string;
export function pluralize (singular: string, plural: string, count: number): string;

export function pluralize (singular: string, arg2: unknown, arg3?: unknown): string {
	const count = arg3 ?? arg2;
	const plural = arg3 ? arg2 as string : singular + 's';

	return count === 1 ? singular : plural;
}
