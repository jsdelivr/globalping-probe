import * as path from 'node:path';
import * as url from 'node:url';

export default function wallaby () {
	const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
	return {
		testFramework: 'mocha',
		files: [
			'src/**/*.ts',
			'config/*',
			'test/mocks/**/*',
			'test/plugins/**/*',
			'test/utils.ts',
			'test/hooks.ts',
			'test/snapshots/**/*.json',
			'package.json',
		],
		tests: [
			'test/unit/**/*.test.ts',
		],
		setup (w) {
			const path = require('path');
			w.testFramework.addFile(path.resolve(process.cwd(), 'test/hooks.js'));
		},
		env: {
			type: 'node',
			params: {
				runner: `--experimental-specifier-resolution=node --loader ${url.pathToFileURL(path.join(__dirname, 'node_modules/testdouble/lib/index.mjs'))}`,
				env: 'NODE_ENV=test;NEW_RELIC_ENABLED=false;NEW_RELIC_LOG_ENABLED=false',
			},
		},
		preprocessors: {
			'**/*.ts': file => file.content.replace(/\.ts/g, '.js'),
		},
		workers: { restart: true },
	};
}
