import type { FailureSource } from '../types.js';

const targetMessages = [
	'Name or service not known',
	'No address associated with hostname',
	'Address family for hostname not supported',
	'unknown host',
];

const resolverMessages = [
	'Temporary failure in name resolution',
	'Non-recoverable failure in name resolution',
];

export const getNativeNameResolutionFailureSource = (output: string): FailureSource | undefined => {
	const normalizedOutput = output.toLowerCase();

	if (targetMessages.some(message => normalizedOutput.includes(message.toLowerCase()))) {
		return 'target';
	}

	if (resolverMessages.some(message => normalizedOutput.includes(message.toLowerCase()))) {
		return 'resolver';
	}

	return undefined;
};
