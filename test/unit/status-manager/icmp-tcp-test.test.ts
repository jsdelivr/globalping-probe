import { EventEmitter } from 'node:events';
import config from 'config';
import * as sinon from 'sinon';
import { expect } from 'chai';
import { useSandboxWithFakeTimers } from '../../utils.js';
import { IcmpTcpTest, initIcmpTcpTest, getIcmpTcpTest } from '../../../src/status-manager/icmp-tcp-test.js';
import type { PingOptions } from '../../../src/command/ping-command.js';

// Builds a minimal ICMP ping output that parse() can extract stats.avg from.
const makeIcmpOutput = (avg: number) => [
	`PING test.host (1.2.3.4): 56 data bytes`,
	`--- test.host ping statistics ---`,
	`3 packets transmitted, 3 received, 0% packet loss, time 3000ms`,
	`rtt min/avg/max/mdev = ${avg}/${avg}/${avg}/0.000 ms`,
].join('\n');

// Minimal TcpPingData[] array with a statistics entry that icmp-tcp-test reads avg from.
const makeTcpResult = (avg: number) => [
	{ type: 'statistics', avg, min: avg, max: avg, mdev: 0, total: 3, rcv: 3, drop: 0, loss: 0, time: 1000, address: '1.2.3.4', hostname: 'test.host', port: 443 },
];

describe('IcmpTcpTest', () => {
	let sandbox: sinon.SinonSandbox;
	let socketEvents: EventEmitter;
	let socket: { on: EventEmitter['on']; emit: sinon.SinonStub };
	let updateStatus: sinon.SinonStub;
	let pingCmd: sinon.SinonStub;
	const tcpPingStub = sinon.stub();

	const emitIsProxy = async (isProxy: boolean | null) => {
		await Promise.all(socketEvents.listeners('api:connect:isProxy').map(listener => Promise.resolve(listener({ isProxy }))));
	};

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers();
		socketEvents = new EventEmitter();

		socket = {
			on: socketEvents.on.bind(socketEvents),
			emit: sandbox.stub(),
		};

		updateStatus = sandbox.stub();
		pingCmd = sandbox.stub();

		// Default: ICMP avg=20, TCP avg=10 → diff=10 (below all thresholds)
		pingCmd.resolves({ stdout: makeIcmpOutput(20) });
		tcpPingStub.resolves(makeTcpResult(10));
	});

	afterEach(() => {
		sandbox.restore();
		pingCmd.reset();
		tcpPingStub.reset();
	});

	it('should pass and call updateStatus(false) when diffs are below all thresholds', async () => {
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(tcpPingStub.callCount).to.equal(6);
		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should pass when one diff >= 60 but isProxy is false', async () => {
		const [ highDiffTarget ] = config.get<string[]>('status.icmpTcpTargets');
		pingCmd.callsFake(async (opts: PingOptions) => ({
			stdout: makeIcmpOutput(opts.target === highDiffTarget ? 70 : 20),
		}));

		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should pass when all measurements fail (null diffs)', async () => {
		pingCmd.rejects(new Error('unreachable'));
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should fail when one diff >= 100 (rule 1), confirmed on second run', async () => {
		pingCmd.resolves({ stdout: makeIcmpOutput(110) }); // diff = 100
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(pingCmd.callCount).to.equal(12);
		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', true ]);
	});

	it('should fail when two or more diffs >= 60 (rule 2), confirmed on second run', async () => {
		pingCmd.resolves({ stdout: makeIcmpOutput(70) }); // diff = 60 across all 3 locations
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', true ]);
	});

	it('should fail when one diff >= 60 and isProxy is true (rule 3), confirmed on second run', async () => {
		pingCmd.resolves({ stdout: makeIcmpOutput(75) }); // diff = 65
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(true);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', true ]);
	});

	it('should fail when only IPv6 diffs exceed threshold (IPv4 passes)', async () => {
		pingCmd.callsFake(async (opts: PingOptions) => ({
			stdout: makeIcmpOutput(opts.ipVersion === 6 ? 70 : 20),
		}));

		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', true ]);
	});

	it('should fail when only IPv4 diffs exceed threshold (IPv6 passes)', async () => {
		pingCmd.callsFake(async (opts: PingOptions) => ({
			stdout: makeIcmpOutput(opts.ipVersion === 4 ? 70 : 20),
		}));

		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', true ]);
	});

	it('should pass ipVersion 4 then 6 to pingCmd and tcpPing for each target', async () => {
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		const pingIpVersions = pingCmd.getCalls().map(c => (c.args[0] as PingOptions).ipVersion);
		expect(pingIpVersions.slice(0, 3)).to.deep.equal([ 4, 4, 4 ]);
		expect(pingIpVersions.slice(3, 6)).to.deep.equal([ 6, 6, 6 ]);

		const tcpIpVersions = tcpPingStub.getCalls().map(c => c.args[0].ipVersion as 4 | 6);
		expect(tcpIpVersions.slice(0, 3)).to.deep.equal([ 4, 4, 4 ]);
		expect(tcpIpVersions.slice(3, 6)).to.deep.equal([ 6, 6, 6 ]);
	});

	it('should pass when TCP ping has no statistics row (null diffs)', async () => {
		tcpPingStub.resolves([{ type: 'start', address: '1.2.3.4', hostname: 'h', port: 443 }]);
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should pass when tcpPing rejects (null diffs)', async () => {
		tcpPingStub.rejects(new Error('tcp down'));
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should fail when isProxy becomes true after pass with one borderline IPv4 diff', async () => {
		const [ firstTarget ] = config.get<string[]>('status.icmpTcpTargets');
		pingCmd.callsFake(async (opts: PingOptions) => ({
			stdout: makeIcmpOutput(opts.target === firstTarget && opts.ipVersion === 4 ? 75 : 20),
		}));

		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await test.start();
		expect(updateStatus.callCount).to.equal(0);

		await emitIsProxy(false);
		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);

		await emitIsProxy(true);
		expect(updateStatus.args[1]).to.deep.equal([ 'icmp-tcp-test-failed', true ]);
	});

	it('should not block if first run exceeds threshold but second run does not', async () => {
		let icmpCallNum = 0;
		pingCmd.callsFake(async () => {
			// First 6 calls (IPv4 then IPv6 for 3 targets): avg=110 → diff=100; rest: avg=20 → diff=10
			return { stdout: makeIcmpOutput(icmpCallNum++ < 6 ? 110 : 20) };
		});

		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should run measure cycle again on interval', async () => {
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.callCount).to.equal(1);

		await sandbox.clock.tickAsync(60 * 60 * 1000);

		expect(pingCmd.callCount).to.equal(12);
		expect(updateStatus.callCount).to.equal(2);
	});

	it('should stop interval checks after stop call', async () => {
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		await test.start();
		test.stop();
		await sandbox.clock.tickAsync(60 * 60 * 1000);

		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.callCount).to.equal(1);
	});

	it('should not schedule next hour when stop() before first measure completes', async () => {
		pingCmd.callsFake(() => new Promise<{ stdout: string }>((resolve) => {
			queueMicrotask(() => resolve({ stdout: makeIcmpOutput(20) }));
		}));

		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);
		const p = test.start();
		test.stop();
		await p;

		await sandbox.clock.tickAsync(60 * 60 * 1000);
		expect(pingCmd.callCount).to.equal(6);
		expect(updateStatus.callCount).to.equal(1);
	});

	it('should wait for isProxy before calling updateStatus when isProxy arrives after start()', async () => {
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await test.start();

		expect(updateStatus.callCount).to.equal(0);

		await emitIsProxy(false);

		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should call updateStatus immediately after start() when isProxy arrived before start()', async () => {
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await emitIsProxy(false);

		expect(updateStatus.callCount).to.equal(0);

		await test.start();

		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should never call updateStatus if isProxy never arrives', async () => {
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		await test.start();

		expect(updateStatus.callCount).to.equal(0);
	});

	it('should allow start() to run normally after stop()', async () => {
		const test = new IcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		test.stop();
		await emitIsProxy(false);
		await test.start();

		expect(updateStatus.callCount).to.equal(1);
		expect(updateStatus.args[0]).to.deep.equal([ 'icmp-tcp-test-failed', false ]);
	});

	it('should return same instance for initIcmpTcpTest and getIcmpTcpTest', () => {
		const test = initIcmpTcpTest(updateStatus, socket as never, pingCmd, tcpPingStub);
		expect(test).to.equal(getIcmpTcpTest());
	});
});
