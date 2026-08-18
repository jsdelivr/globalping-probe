import { expect } from 'chai';
import * as sinon from 'sinon';
import { resolveCommandTarget } from '../../../src/helper/resolve-command-target.js';
import { InternalError } from '../../../src/lib/internal-error.js';

describe('resolveCommandTarget', () => {
	it('keeps a requested hostname without performing a target PTR lookup', async () => {
		const signal = new AbortController().signal;
		const lookup = sinon.stub().resolves([ '1.1.1.1', 4 ]);

		expect(await resolveCommandTarget('example.com', 4, signal, lookup)).to.deep.equal({
			address: '1.1.1.1',
			hostname: 'example.com',
		});

		expect(lookup.calledOnceWithExactly('example.com', { family: 4, signal })).to.be.true;
	});

	it('starts with PTR lookup when the target is already an IP', async () => {
		const signal = new AbortController().signal;
		const lookup = sinon.stub().resolves([ 'one.one.one.one' ]);

		expect(await resolveCommandTarget('1.1.1.1', 4, signal, lookup)).to.deep.equal({
			address: '1.1.1.1',
			hostname: 'one.one.one.one',
		});

		expect(lookup.calledOnceWithExactly('1.1.1.1', { rrtype: 'PTR', signal })).to.be.true;
	});

	it('classifies an aborted forward lookup as resolver', async () => {
		const controller = new AbortController();
		controller.abort();
		const lookup = sinon.stub().rejects(controller.signal.reason);

		try {
			await resolveCommandTarget('example.com', 4, controller.signal, lookup);
			expect.fail('Expected target resolution to fail.');
		} catch (error: unknown) {
			expect(error).to.be.instanceOf(InternalError);

			expect(error).to.include({
				message: 'The measurement command timed out.',
				failureSource: 'resolver',
			});
		}
	});
});
