
import process from 'node:process';
import { expect } from 'chai';
import * as td from 'testdouble';
import * as sinon from 'sinon';
import * as constants from '../../../src/constants.js';
import { useSandboxWithFakeTimers } from '../../utils.js';

class MockHTTPError extends Error {}
class MockRequestError extends Error {}
class MockTimeoutError extends Error {}

describe('updater module', () => {
	let sandbox: sinon.SinonSandbox;
	const gotStub = sinon.stub();

	before(async () => {
		await td.replaceEsm('got', {
			HTTPError: MockHTTPError,
			RequestError: MockRequestError,
			TimeoutError: MockTimeoutError,
		}, gotStub);
	});

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers();
	});

	afterEach(() => {
		sandbox.restore();
	});

	after(() => {
		td.reset();
	});

	it('should check for an update and call process.exit if there is a newer version', async () => {
		const killStub = sandbox.stub(process, 'kill');
		await td.replaceEsm('../../../src/constants.ts', { ...constants, VERSION: '0.6.0' });
		gotStub.returns({ json: async () => ({ version: 'v0.7.0' }) });

		await import('../../../src/lib/updater.js');
		await sandbox.clock.tickAsync(650 * 1000);

		expect(gotStub.firstCall.args).to.deep.equal([
			'https://data.jsdelivr.com/v1/packages/gh/jsdelivr/globalping-probe/resolved',
			{ timeout: { request: 15_000 } },
		]);

		expect(killStub.called).to.be.true;
	});

	it('should check for an update and call do nothing if there is no newer version', async () => {
		const killStub = sandbox.stub(process, 'kill');
		await td.replaceEsm('../../../src/constants.ts', { ...constants, VERSION: '0.7.0' });
		gotStub.returns({ json: async () => ({ version: 'v0.7.0' }) });

		await import('../../../src/lib/updater.js');
		await sandbox.clock.tickAsync(650 * 1000);

		expect(killStub.called).to.be.false;
	});

	it('should check for an update and do not throw an error if there is a timeout error', async () => {
		await td.replaceEsm('../../../src/constants.ts', { ...constants, VERSION: '0.7.0' });
		gotStub.returns({ json: async () => Promise.reject(new MockTimeoutError('other error')) });
		await import('../../../src/lib/updater.js');
		await sandbox.clock.tickAsync(650 * 1000);
	});
});
