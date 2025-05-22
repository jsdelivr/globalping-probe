import { defineConfig } from 'eslint/config';
import typescript from '@martin-kolarik/eslint-config/typescript.js';
import typescriptTypeChecked from '@martin-kolarik/eslint-config/typescript-type-checked.js';

export default defineConfig([
	typescript,
	{
		ignores: [
			'coverage/**',
			'dist/**',
			'test/e2e/**',
		],
	},
	{
		files: [ 'src/**/*.ts' ],
		extends: [ typescriptTypeChecked ],

		languageOptions: {
			sourceType: 'module',

			parserOptions: {
				project: true,
			},
		},
	},
	{
		rules: {
			'no-duplicate-imports': 'off',
			'@stylistic/no-extra-parens': 'off',
		},
	},
	{
		files: [ 'test/**' ],

		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
]);
