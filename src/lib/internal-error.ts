export class InternalError extends Error {
	expose?: boolean;

	constructor (message: string, isExposed = true) {
		super(message);

		this.expose = isExposed;
	}
}

export const isExposed = (error: unknown): error is InternalError => error instanceof InternalError && error.expose === true && error.message.length > 0;
