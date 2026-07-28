import { expect } from 'chai';
import Joi from 'joi';
import { validateCommandOptions } from '../../../src/helper/validate-command-options.js';

describe('validate command options', () => {
	it('should allow unknown fields at any nesting level', () => {
		const schema = Joi.object({
			type: Joi.string().valid('example').required(),
			nested: Joi.object({
				known: Joi.string().required(),
			}).required(),
		});

		const result = validateCommandOptions(schema, {
			type: 'example',
			futureTopLevelOption: true,
			nested: {
				known: 'value',
				futureNestedOption: true,
			},
		});

		expect(result.error).to.equal(undefined);

		expect(result.value).to.deep.equal({
			type: 'example',
			futureTopLevelOption: true,
			nested: {
				known: 'value',
				futureNestedOption: true,
			},
		});
	});
});
