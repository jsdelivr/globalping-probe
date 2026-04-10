import * as sinon from 'sinon';
import { expect } from 'chai';
import { useSandboxWithFakeTimers } from '../../utils.js';
import { DisconnectTest, initDisconnectTest, getDisconnectTest } from '../../../src/status-manager/disconnect-test.js';

describe('DisconnectTest', () => {
	let sandbox: sinon.SinonSandbox;
	let updateStatus: sinon.SinonStub;

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers();
		updateStatus = sandbox.stub();
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('should not update status before reaching disconnect threshold', () => {
		const disconnectTest = new DisconnectTest(updateStatus);
		disconnectTest.reportDisconnect();
		disconnectTest.reportDisconnect();

		expect(updateStatus.callCount).to.equal(0);
	});

	it('should mark status as too many disconnects at threshold', () => {
		const disconnectTest = new DisconnectTest(updateStatus);
		disconnectTest.reportDisconnect();
		disconnectTest.reportDisconnect();
		disconnectTest.reportDisconnect();

		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'too-many-disconnects', true ]);
	});

	it('should clear too many disconnects when cache becomes empty', async () => {
		sandbox.stub(performance, 'now').callsFake(() => sandbox.clock.now);
		const disconnectTest = new DisconnectTest(updateStatus);
		disconnectTest.reportDisconnect();
		disconnectTest.reportDisconnect();
		disconnectTest.reportDisconnect();

		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'too-many-disconnects', true ]);

		await sandbox.clock.tickAsync(5 * 60 * 1000 + 1000);

		expect(updateStatus.callCount).to.equal(4);
		expect(updateStatus.args[3]).to.deep.equal([ 'too-many-disconnects', false ]);
	});

	it('should return same instance for initDisconnectTest and getDisconnectTest', () => {
		const disconnectTest = initDisconnectTest(updateStatus);
		const disconnectTest2 = getDisconnectTest();

		expect(disconnectTest).to.equal(disconnectTest2);
	});
});
