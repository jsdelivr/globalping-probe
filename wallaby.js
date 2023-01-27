import * as path from 'node:path';
import * as url from 'node:url';

export default function wallaby() {
	const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
	return {
		testFramework: 'mocha',
		files: [
			'src/**/*.ts',
			'config/*',
			'test/mocks/**/*',
			'test/utils.ts',
			'package.json',
		],
		tests: [
			'test/unit/**/*.test.ts',
		],
		env: {
			type: 'node',
			params: {
				runner: `--experimental-specifier-resolution=node --loader ${path.join(__dirname, 'node_modules/testdouble/lib/index.mjs')}`,
				env: 'NODE_ENV=test;NEW_RELIC_ENABLED=false;NEW_RELIC_LOG_ENABLED=false',
			},
		},
		preprocessors: {
			'**/*.ts': file => file.content.replace(/\.ts/g, '.js'),
		},
		workers: {restart: true},
	};
}
