import { expect } from 'chai';
import * as td from 'testdouble';
import * as sinon from 'sinon';

describe('looksLikeV1HardwareDevice', () => {
	const sandbox = sinon.createSandbox();
	const cpusStub = sinon.stub();
	const hostnameStub = sinon.stub();
	const totalmemStub = sinon.stub();
	let looksLikeV1HardwareDevice: () => boolean;

	const mockRealHardwareValues = () => {
		// Based on https://github.com/jsdelivr/globalping-hwprobe/issues/37#issuecomment-2002039986
		cpusStub.returns([
			{
				model: 'ARMv7 Processor rev 5 (v7l)',
			},
			{
				model: 'ARMv7 Processor rev 5 (v7l)',
			},
			{
				model: 'ARMv7 Processor rev 5 (v7l)',
			},
			{
				model: 'ARMv7 Processor rev 5 (v7l)',
			},
		]);

		hostnameStub.returns('globalping-probe-708e');
		totalmemStub.returns(520839168);
	};

	before(async () => {
		await td.replaceEsm('node:os', {}, {
			cpus: cpusStub,
			hostname: hostnameStub,
			totalmem: totalmemStub,
		});

		({ looksLikeV1HardwareDevice } = await import('../../../src/lib/util.js'));
	});

	afterEach(() => {
		sandbox.reset();
		sandbox.restore();
	});

	after(() => {
		td.reset();
	});

	it('should return true for HW probes', () => {
		mockRealHardwareValues();
		expect(looksLikeV1HardwareDevice()).to.be.true;
	});

	it('should return false for different CPUs', () => {
		mockRealHardwareValues();

		cpusStub.returns([
			{
				model: 'Some Intel CPU',
			},
			{
				model: 'Some Intel CPU',
			},
			{
				model: 'Some Intel CPU',
			},
			{
				model: 'Some Intel CPU',
			},
		]);

		expect(looksLikeV1HardwareDevice()).to.be.false;
	});

	it('should return false for different hostnames', () => {
		mockRealHardwareValues();
		hostnameStub.returns('gp-probe');

		expect(looksLikeV1HardwareDevice()).to.be.false;
	});

	it('should return false for unexpected memory values', () => {
		mockRealHardwareValues();
		totalmemStub.returns(1000 * 1e6);

		expect(looksLikeV1HardwareDevice()).to.be.false;
	});
});
