import type { FailureSource } from '../types.js';

export class InternalError extends Error {
	expose?: boolean;
	failureSource: FailureSource;

	constructor (message: string, isExposed = true, failureSource: FailureSource = 'internal') {
		super(message);

		this.expose = isExposed;
		this.failureSource = failureSource;
	}
}

export const isExposed = (error: unknown): error is InternalError => error instanceof InternalError && error.expose === true && error.message.length > 0;
const knownFailureSources = [ 'target', 'resolver', 'internal' ];

export const getFailureSource = (error: unknown, fallback: FailureSource): FailureSource => {
	const failureSource = (error as { failureSource?: FailureSource } | null)?.failureSource;

	return failureSource && knownFailureSources.includes(failureSource) ? failureSource : fallback;
};
