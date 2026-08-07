type ErrorWithCode = {
	code?: unknown;
	cause?: unknown;
};

const findErrorCode = (error: unknown, seen: WeakSet<object>): string | undefined => {
	if (!error || typeof error !== 'object') {
		return undefined;
	}

	if (seen.has(error)) {
		return undefined;
	}

	seen.add(error);
	const { code, cause } = error as ErrorWithCode;

	if (typeof code === 'string' && code.length > 0) {
		return code;
	}

	return findErrorCode(cause, seen);
};

export const getErrorCode = (error: unknown): string | undefined => findErrorCode(error, new WeakSet());
