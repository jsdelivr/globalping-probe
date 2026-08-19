import { expect } from 'chai';
import * as sinon from 'sinon';
import { AsyncLookupMap } from '../../../src/helper/async-lookup-map.js';

describe('async lookup map', () => {
	it('should start each lookup once and expose its value as soon as it resolves', async () => {
		let resolveLookup!: (value: string) => void;
		const resolver = sinon.stub().returns(new Promise<string>((resolve) => {
			resolveLookup = resolve;
		}));
		const lookups = new AsyncLookupMap(resolver);

		lookups.add('1.1.1.1');
		lookups.add('1.1.1.1');

		expect(resolver.calledOnceWithExactly('1.1.1.1')).to.be.true;
		expect(lookups.get('1.1.1.1')).to.equal(undefined);

		resolveLookup('one.one.one.one');
		await lookups.wait();

		expect(lookups.get('1.1.1.1')).to.equal('one.one.one.one');
	});

	it('should keep a seeded value without starting a lookup', async () => {
		const resolver = sinon.stub().resolves('ignored.example');
		const lookups = new AsyncLookupMap(resolver);

		lookups.set('1.1.1.1', 'target.example');
		lookups.add('1.1.1.1');
		await lookups.wait();

		expect(resolver.notCalled).to.be.true;
		expect(lookups.get('1.1.1.1')).to.equal('target.example');
	});

	it('should ignore failed lookups when waiting', async () => {
		const lookups = new AsyncLookupMap(async () => {
			throw new Error('lookup failed');
		});

		lookups.add('1.1.1.1');
		await lookups.wait();

		expect(lookups.get('1.1.1.1')).to.equal(undefined);
	});
});
