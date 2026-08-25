module.exports = {
	'timeout': 30000,
	'extension': [
		'ts',
	],
	'node-option': [
		'experimental-specifier-resolution=node',
		'loader=ts-node/esm',
		'loader=testdouble',
	],
	'require': [
		'./test/compat/hooks.ts',
	],
	'spec': [
		'test/compat/**/*.test.ts',
	],
};
