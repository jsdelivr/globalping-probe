import * as td from 'testdouble';
import {expect} from 'chai';
import * as sinon from 'sinon';

describe('hasRequired function', () => {
	let hasRequired: () => Promise<boolean>;
	const execa = sinon.stub().resolves();

	afterEach(() => {
		execa.reset();
		execa.resolves();
	});

	before(async () => {
		await td.replaceEsm('execa', {execa});
		({hasRequired} = await import('../../../src/lib/dependencies.js'));
	});

	it('should check that unbuffer exists', async () => {
		const result = await hasRequired();
		expect(execa.args[0]).to.deep.equal(['which', ['unbuffer']]);
		expect(result).to.equal(true);
	});

	it('should check that unbuffer doesn`t exist', async () => {
		execa.rejects();
		const result = await hasRequired();
		expect(execa.args[0]).to.deep.equal(['which', ['unbuffer']]);
		expect(result).to.equal(false);
	});
});
