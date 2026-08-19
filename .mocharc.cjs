if (process.env.LOG_LEVEL === undefined) {
	process.env.LOG_LEVEL = 'error';
}

module.exports = {
	'timeout': 5000,
	'extension': [
		'ts',
	],
	'node-option': [
		'experimental-specifier-resolution=node',
		'loader=ts-node/esm',
		'loader=testdouble',
	],
	'require': [
		'./test/hooks.ts',
	],
	'spec': [
		'test/unit/**/*.test.ts',
	],
};
