import type { ValidationError } from 'joi';

export class InvalidOptionsException extends Error {
	constructor (command: string, error: ValidationError) {
		super();
		this.message = `invalid options for command '${command}': ${error.message}`;
	}
}
