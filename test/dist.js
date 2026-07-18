import { describe, it } from 'node:test';
import { setTimeout } from 'timers/promises';

describe('dist build', () => {
	it('loads and doesn\'t crash', async () => {
		// using String() here to avoid linter checks as the file doesn't exist before `npm run build`
		await import(String('../dist/index.js'));

		await setTimeout(10000);

		process.exit();
	});
});
