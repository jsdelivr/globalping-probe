import { expect } from 'chai';
import { EventEmitter } from 'node:events';

export type CommandResult = Record<string, any> & {
	status?: string;
	failureSource?: string;
	rawOutput?: string;
	resolvedAddress?: string | null;
	timings?: unknown[];
	hops?: Array<{ resolvedAddress: string | null; timings: unknown[] }>;
	statusCode?: number | null;
	answers?: Array<{ value: string }>;
};

export const loopbackTargets = [
	{ target: '127.0.0.1', ipVersion: 4 as const },
	{ target: '0:0:0:0:0:0:0:1', ipVersion: 6 as const },
];

const finiteNumbers = (value: unknown): number[] => {
	if (typeof value === 'number') {
		return [ value ];
	}

	if (Array.isArray(value)) {
		return value.flatMap(finiteNumbers);
	}

	if (value && typeof value === 'object') {
		return Object.values(value).flatMap(finiteNumbers);
	}

	return [];
};

export const runCommand = async (command: { run: (...args: any[]) => Promise<unknown> }, options: unknown): Promise<CommandResult> => {
	const socket = new EventEmitter();
	let result: CommandResult | undefined;

	socket.on('probe:measurement:result', (event) => {
		result = event.result;
	});

	await command.run(socket as any, 'measurement', 'test', options);
	expect(result, 'command result').to.not.equal(undefined);
	return result!;
};

export const expectFiniteNumbers = (result: CommandResult) => {
	for (const value of finiteNumbers(result)) {
		expect(Number.isFinite(value)).to.equal(true);
	}
};
