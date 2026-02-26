import type { ValidationError } from 'joi';

const errorMessages: Record<string, string> = {
	'ip.private': 'Private IP ranges are not allowed.',
};

export class InvalidOptionsException extends Error {
	constructor (command: string, error: ValidationError) {
		super();

		const specialError = error.details.find(item => errorMessages[item.type]);

		if (specialError) {
			this.message = errorMessages[specialError.type]!;
			return;
		}

		this.message = `invalid options for command '${command}': ${error.message}`;
	}
}
