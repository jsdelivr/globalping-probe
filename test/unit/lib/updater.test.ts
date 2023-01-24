import process from 'node:process';
import {expect} from 'chai';
import * as td from 'testdouble';
import * as sinon from 'sinon';
import * as constants from '../../../src/constants.js';

describe('updater module', () => {
	let sandbox: sinon.SinonSandbox;
	const gotStub = sinon.stub();

	before(async () => {
		td.replaceEsm('got', null, gotStub);
	});

	beforeEach(() => {
		sandbox = sinon.createSandbox({useFakeTimers: true});
	});

	afterEach(() => {
		sandbox.restore();
	});

	after(() => {
		td.reset();
	})

	it('should check for update and call process.exit if there is newer version', async () => {
		const killStub = sandbox.stub(process, 'kill');
		td.replaceEsm('../../../src/constants.ts', {...constants, VERSION: '0.6.0'});
		gotStub.returns({json: () => ({tag_name: 'v0.7.0'})});

		await import('../../../src/lib/updater.js');
		await sandbox.clock.tickAsync(650 * 1000);

		expect(gotStub.firstCall.args).to.deep.equal([
			'https://api.github.com/repos/jsdelivr/globalping-probe/releases/latest',
			{ timeout: { request: 15000 } }
		]);
		expect(killStub.called).to.be.true;
	});

	it('should check for update and call do nothing if there is no newer version', async () => {
		const killStub = sandbox.stub(process, 'kill');
		td.replaceEsm('../../../src/constants.ts', {...constants, VERSION: '0.7.0'});
		gotStub.returns({json: () => ({tag_name: 'v0.7.0'})});

		await import('../../../src/lib/updater.js');
		await sandbox.clock.tickAsync(650 * 1000);

		expect(killStub.called).to.be.false;
	});
});
