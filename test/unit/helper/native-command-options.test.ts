import { expect } from 'chai';
import { getNativeCommandOptions } from '../../../src/helper/native-command-options.js';

describe('native command options', () => {
	it('should pin the native command locale', () => {
		expect(getNativeCommandOptions(5000)).to.deep.equal({
			timeout: 5000,
			env: { LC_ALL: 'C' },
		});
	});
});
