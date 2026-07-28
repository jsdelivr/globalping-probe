import Joi from 'joi';

export const validateCommandOptions = <T> (schema: Joi.ObjectSchema<T>, options: unknown) => {
	return schema.validate(options, { allowUnknown: true });
};
