import { EventEmitter } from 'node:events';
import {expect} from 'chai';
import * as td from 'testdouble';
import * as sinon from 'sinon';

const fakeLocation = {
	continent: 'EU',
	region: 'Western Europe',
	country: 'BE',
	city: 'Brussels',
	asn: 396982,
	latitude: 50.8505,
	longitude: 4.3488,
	state: null
};

describe('index module', () => {
	let sandbox: sinon.SinonSandbox;
	const execaStub = sinon.stub();
	const gotStub = sinon.stub();

	const mockSocket = new EventEmitter();
	const probeStatusReadyStub = sinon.stub();
	const probeDnsUpdateStub = sinon.stub();
	mockSocket.on('probe:status:ready', probeStatusReadyStub);
	mockSocket.on('probe:dns:update', probeDnsUpdateStub);
	const ioStub = sinon.stub().returns(mockSocket);

	before(async () => {
		td.replaceEsm('execa', {execa: execaStub});
		td.replaceEsm('socket.io-client', {io: ioStub});
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

	it('should initialize and connect to the API server', async () => {
		await import('../../src/index.js');
		mockSocket.emit('connect');
		mockSocket.emit('api:connect:location', fakeLocation);

		expect(execaStub.firstCall.args[0].endsWith('/src/sh/unbuffer.sh')).to.be.true;
		expect(ioStub.callCount).to.equal(1);
		expect(ioStub.firstCall.args).to.deep.equal([
			'ws://api.globalping.io/probes',
			{
				transports: [ 'websocket' ],
				reconnectionDelay: 100,
				reconnectionDelayMax: 500,
				query: { version: '0.11.0' }
			}
		]);
		expect(execaStub.secondCall.args).to.deep.equal([ 'which', [ 'unbuffer' ] ]);
		await sandbox.clock.nextAsync();
		expect(probeStatusReadyStub.callCount).to.equal(1);
		expect(probeStatusReadyStub.firstCall.args).to.deep.equal([ {} ]);
		expect(probeDnsUpdateStub.callCount).to.equal(1);
	});

	it('should send stats in configured interval', () => {

	});

	it('should handle measurement request', () => {

	})
});
