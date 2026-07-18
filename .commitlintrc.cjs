const { default: conventional } = require('@commitlint/config-conventional');

module.exports = {
	extends: [ '@commitlint/config-conventional' ],
	rules: {
		'type-enum': [
			2,
			'always',
			[ ...conventional.rules['type-enum'][2], 'misc' ],
		],
	},
};
