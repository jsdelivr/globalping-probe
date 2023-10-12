import { describe, it } from 'node:test';
import { setTimeout } from 'timers/promises';

describe('dist build', () => {
	it('loads and doesn\'t crash', async () => {
		await import('../dist/index.js');

		await setTimeout(10000);

		process.exit();
	});
});
