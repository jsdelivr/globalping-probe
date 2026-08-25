import { expect } from 'chai';
import { EventEmitter } from 'node:events';

export const loopbackTargets = [
	{ target: '127.0.0.2', ipVersion: 4 as const, resolvedHostname: 'ipv4-loopback.compat.test', asn: 64512 },
	{ target: '0:0:0:0:0:0:0:1', ipVersion: 6 as const, asn: 64513 },
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

export const runCommand = async (command: { run: (...args: any[]) => Promise<unknown> }, options: unknown) => {
	const socket = new EventEmitter();
	let result: any;

	socket.on('probe:measurement:result', (event) => {
		result = event.result;
	});

	await command.run(socket as any, 'measurement', 'test', options);
	expect(result, 'command result').to.not.equal(undefined);
	return result;
};

export const expectFiniteNumbers = (result: unknown) => {
	for (const value of finiteNumbers(result)) {
		expect(Number.isFinite(value)).to.equal(true);
	}
};
