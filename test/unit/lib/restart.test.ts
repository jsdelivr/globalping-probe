import process from 'node:process';
import { expect } from 'chai';
import * as sinon from 'sinon';

describe('restart module', () => {
	let sandbox: sinon.SinonSandbox;

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true });
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('should restart if uptime is too high', async () => {
		const killStub = sandbox.stub(process, 'kill');
		const uptimeStub = sandbox.stub(process, 'uptime').returns(800_000);

		await import('../../../src/lib/restart.js');
		sandbox.clock.tick(87_000_000);

		expect(uptimeStub.called).to.be.true;
		expect(killStub.called).to.be.true;
	});
});
