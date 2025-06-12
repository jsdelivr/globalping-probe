import net from 'node:net';
import * as sinon from 'sinon';
import * as td from 'testdouble';
import { expect } from 'chai';
import type {
	TcpPingData,
	InternalTcpPingOptions,
} from '../../../../../src/command/handlers/ping/tcp-ping.js';

describe('tcp-ping', () => {
	let sandbox: sinon.SinonSandbox;
	let socketMock: any;
	let performanceNowStub: sinon.SinonStub;
	let tcpPingSingle: any;
	let tcpPing: any;
	let toRawTcpOutput: any;
	let formatTcpPingResult: any;

	class SocketMock {
		constructor () {
			return socketMock;
		}
	}

	const performanceMock = {
		now: () => performance.now(),
	};

	before(async () => {
		sandbox = sinon.createSandbox();

		await td.replaceEsm('node:net', {
			...net,
			Socket: SocketMock,
		});

		await td.replaceEsm('node:perf_hooks', { performance: performanceMock });

		const tcpPingModule = await import('../../../../../src/command/handlers/ping/tcp-ping.js');
		tcpPingSingle = tcpPingModule.tcpPingSingle;
		tcpPing = tcpPingModule.tcpPing;
		toRawTcpOutput = tcpPingModule.toRawTcpOutput;
		formatTcpPingResult = tcpPingModule.formatTcpPingResult;
	});

	beforeEach(() => {
		performanceNowStub = sandbox.stub(performanceMock, 'now');
		performanceNowStub.onFirstCall().returns(1000);

		socketMock = {
			on: sandbox.stub().returnsThis(),
			setNoDelay: sandbox.stub().returnsThis(),
			setTimeout: sandbox.stub().returnsThis(),
			connect: sandbox.stub().returnsThis(),
			destroy: sandbox.stub().returnsThis(),
		};
	});

	afterEach(() => {
		sandbox.restore();
	});

	after(async () => {
		td.reset();
	});

	describe('tcpPingSingle', () => {
		it('should resolve with success when socket connects', async () => {
			performanceNowStub.onFirstCall().returns(1000);
			performanceNowStub.onSecondCall().returns(1010);

			socketMock.on.withArgs('connect', sinon.match.func).callsFake((_event: string, callback: () => void) => {
				setTimeout(() => callback(), 10);
				return socketMock;
			});

			const result = await tcpPingSingle('example.com', '93.184.216.34', 80, 4, 1000);

			expect(result).to.deep.equal({
				type: 'probe',
				address: '93.184.216.34',
				hostname: 'example.com',
				port: 80,
				rtt: 10,
				success: true,
			});

			expect(socketMock.setNoDelay.firstCall.args[0]).to.equal(true);
			expect(socketMock.setTimeout.firstCall.args[0]).to.equal(1000);

			expect(socketMock.connect.firstCall.args[0]).to.deep.equal({
				port: 80,
				host: '93.184.216.34',
				family: 4,
			});

			expect(socketMock.destroy.callCount).to.equal(1);
		});

		it('should resolve with error when socket errors', async () => {
			const errorMessage = 'Connection refused';

			socketMock.on.withArgs('error', sinon.match.func).callsFake((_event: string, callback: (e: Error) => void) => {
				setTimeout(() => callback(new Error(errorMessage)), 10);
				return socketMock;
			});

			const result = await tcpPingSingle('example.com', '93.184.216.34', 80, 4, 1000);

			expect(result).to.deep.equal({
				type: 'error',
				message: errorMessage,
			});

			expect(socketMock.destroy.callCount).to.equal(1);
		});

		it('should resolve with timeout when socket times out', async () => {
			socketMock.on.withArgs('timeout', sinon.match.func).callsFake((_event: string, callback: () => void) => {
				setTimeout(() => callback(), 1000);
				return socketMock;
			});

			const result = await tcpPingSingle('example.com', '93.184.216.34', 80, 4, 1000);

			expect(result).to.deep.equal({
				type: 'probe',
				address: '93.184.216.34',
				hostname: 'example.com',
				port: 80,
				rtt: -1,
				success: false,
			});

			expect(socketMock.destroy.callCount).to.equal(1);
		});
	});

	describe('tcpPing', () => {
		const options: InternalTcpPingOptions = {
			target: 'example.com',
			port: 80,
			packets: 3,
			timeout: 1000,
			interval: 500,
			ipVersion: 4,
		};

		it('should handle IP address targets without DNS resolution', async () => {
			const ipTarget = '93.184.216.34';
			const ipOptions = { ...options, target: ipTarget };

			socketMock.on.withArgs('connect', sinon.match.func).callsFake((_event: string, callback: () => void) => {
				setTimeout(() => callback(), 10);
				return socketMock;
			});

			performanceNowStub.onCall(0).returns(1000);
			performanceNowStub.onCall(1).returns(1000);
			performanceNowStub.onCall(2).returns(1010);
			performanceNowStub.onCall(3).returns(1000);
			performanceNowStub.onCall(4).returns(1015);
			performanceNowStub.onCall(5).returns(1000);
			performanceNowStub.onCall(6).returns(1020);
			performanceNowStub.onCall(7).returns(3000.75);

			const results = await tcpPing(ipOptions);

			expect(results.length).to.equal(5); // 1 start + 3 probes + 1 statistics

			expect(results[1]).to.deep.include({
				type: 'probe',
				address: ipTarget,
				hostname: ipTarget,
				port: 80,
				success: true,
			});

			expect(results[4]).to.deep.include({
				type: 'statistics',
				hostname: ipTarget,
				address: ipTarget,
				port: 80,
				total: 3,
				rcv: 3,
				drop: 0,
				loss: 0,
				time: 2001,
				min: 10,
				max: 20,
				avg: 15,
			});

			expect(socketMock.setTimeout.callCount).to.equal(3);
			expect(socketMock.destroy.callCount).to.equal(3);
		});

		it('should resolve hostname using DNS lookup', async () => {
			const resolvedIp = '93.184.216.34';

			socketMock.on.withArgs('connect', sinon.match.func).callsFake((_event: string, callback: () => void) => {
				setTimeout(() => callback(), 10);
				return socketMock;
			});

			performanceNowStub.onCall(0).returns(1000);
			performanceNowStub.onCall(1).returns(1000);
			performanceNowStub.onCall(2).returns(1010);
			performanceNowStub.onCall(3).returns(1000);
			performanceNowStub.onCall(4).returns(1015);
			performanceNowStub.onCall(5).returns(1000);
			performanceNowStub.onCall(6).returns(1020);
			performanceNowStub.onCall(7).returns(3000.75);

			const results = await tcpPing(options, () => [ resolvedIp ]);

			expect(results.length).to.equal(5); // 1 start + 3 probes + 1 statistics

			expect(results[0]).to.deep.include({
				type: 'start',
				address: resolvedIp,
				hostname: options.target,
				port: options.port,
			});

			expect(results[4]).to.deep.include({
				type: 'statistics',
				hostname: options.target,
				address: resolvedIp,
				port: options.port,
				total: 3,
				rcv: 3,
				drop: 0,
				loss: 0,
				time: 2001,
				min: 10,
				max: 20,
				avg: 15,
			});

			expect(socketMock.setTimeout.callCount).to.equal(3);
			expect(socketMock.destroy.callCount).to.equal(3);
		});

		it('should handle DNS resolution errors', async () => {
			const dnsError = new Error('DNS resolution failed');

			const results = await tcpPing(options, () => Promise.reject(dnsError));

			expect(results.length).to.equal(1);

			expect(results[0]).to.deep.equal({
				type: 'error',
				message: dnsError.message,
			});

			expect(socketMock.setTimeout.callCount).to.equal(0);
			expect(socketMock.connect.callCount).to.equal(0);
		});

		it('should handle DNS resolution errors', async () => {
			const results = await tcpPing(options, () => [ '192.168.1.1' ]);

			expect(results.length).to.equal(1);

			expect(results[0]).to.deep.equal({
				type: 'error',
				message: 'Private IP ranges are not allowed.',
			});

			expect(socketMock.setTimeout.callCount).to.equal(0);
			expect(socketMock.connect.callCount).to.equal(0);
		});

		it('should handle mixed success and failure results', async () => {
			const resolvedIp = '93.184.216.34';

			// Set up socket behavior for each ping
			// First ping: success
			let callCount = 0;
			socketMock.on.withArgs('connect', sinon.match.func).callsFake((_event: string, callback: () => void) => {
				callCount++;

				if (callCount === 1 || callCount === 3) {
					// First and third calls succeed
					setTimeout(() => callback(), 10);
				}

				return socketMock;
			});

			// Second ping: timeout
			socketMock.on.withArgs('timeout', sinon.match.func).callsFake((_event: string, callback: () => void) => {
				if (callCount === 2) {
					// Second call times out
					setTimeout(() => callback(), 10);
				}

				return socketMock;
			});

			performanceNowStub.onCall(0).returns(1000); // tcpPing start
			performanceNowStub.onCall(1).returns(1000); // First ping
			performanceNowStub.onCall(2).returns(1010);
			performanceNowStub.onCall(3).returns(1000); // Second ping
			performanceNowStub.onCall(4).returns(1000); // Third ping
			performanceNowStub.onCall(5).returns(1015);
			performanceNowStub.onCall(6).returns(3000.75); // tcpPing end

			const results = await tcpPing(options, () => [ resolvedIp ]);

			expect(results.length).to.equal(5); // 1 start + 3 probes + 1 statistics

			const stats = results[4] as any;
			expect(stats.type).to.equal('statistics');
			expect(stats.total).to.equal(3);
			expect(stats.rcv).to.equal(2); // Only 2 successful probes
			expect(stats.drop).to.equal(1); // 1 failed probe
			expect(stats.loss).to.be.closeTo(33.33, 0.01); // 33.33% loss
			expect(stats.time).to.be.equal(2001);

			expect(stats.min).to.equal(10);
			expect(stats.max).to.equal(15);
			expect(stats.avg).to.be.closeTo(12.5, 0.1); // (10 + 15) / 2
		});

		it('should call onProgress callback when provided', async () => {
			const resolvedIp = '93.184.216.34';

			socketMock.on.withArgs('connect', sinon.match.func).callsFake((_event: string, callback: () => void) => {
				setTimeout(() => callback(), 10);

				return socketMock;
			});

			performanceNowStub.onCall(0).returns(1000);
			performanceNowStub.onCall(1).returns(1000);
			performanceNowStub.onCall(2).returns(1010);
			performanceNowStub.onCall(3).returns(1000);
			performanceNowStub.onCall(4).returns(1010);
			performanceNowStub.onCall(5).returns(1000);
			performanceNowStub.onCall(6).returns(1010);
			performanceNowStub.onCall(7).returns(3000.75);

			const onProgressSpy = sandbox.spy();

			await tcpPing(options, () => [ resolvedIp ], onProgressSpy);

			expect(onProgressSpy.callCount).to.equal(4); // 1 start + 3 probes

			expect(onProgressSpy.firstCall.args[0]).to.deep.include({
				type: 'start',
				address: resolvedIp,
				hostname: options.target,
				port: options.port,
			});

			for (let i = 1; i <= 3; i++) {
				expect(onProgressSpy.getCall(i).args[0]).to.deep.include({
					type: 'probe',
					address: resolvedIp,
					hostname: options.target,
					port: options.port,
					success: true,
				});
			}
		});

		it('should start new pings at regular intervals regardless of previous ping completion', async () => {
			const resolvedIp = '93.184.216.34';

			performanceNowStub.reset();
			performanceNowStub.callThrough();

			// The first ping takes 900 ms (longer than the interval)
			// The second ping takes 300 ms (shorter than the interval)
			// The third ping takes 700 ms
			let pingCount = 0;
			socketMock.on.withArgs('connect', sinon.match.func).callsFake((_event: string, callback: () => void) => {
				pingCount++;
				const delay = pingCount === 1 ? 900 : (pingCount === 2 ? 300 : 700);
				setTimeout(() => callback(), delay);
				return socketMock;
			});

			const results = await tcpPing(options, () => [ resolvedIp ]);

			expect(results.length).to.equal(5); // 1 start + 3 probes + 1 statistics

			// Verify we got the results in the correct order.
			expect(results[1].rtt).to.be.within(899, 1000);
			expect(results[2].rtt).to.be.within(299, 400);
			expect(results[3].rtt).to.be.within(699, 800);

			const stats = results[4] as any;
			expect(stats.type).to.equal('statistics');
			expect(stats.total).to.equal(3);
			expect(stats.rcv).to.equal(3);
			expect(stats.drop).to.equal(0);
			expect(stats.loss).to.equal(0);
			expect(stats.time).to.be.within(1690, 1800);

			expect(stats.min).to.be.within(299, 400);
			expect(stats.max).to.be.within(899, 1000);
			expect(stats.avg).to.be.within(600, 700);
		});
	});

	describe('toRawTcpOutput', () => {
		it('should format start data correctly', () => {
			const lines: TcpPingData[] = [
				{
					type: 'start',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
				},
			];

			const output = toRawTcpOutput(lines);
			expect(output).to.equal('PING example.com (93.184.216.34) on port 80.');
		});

		it('should format successful probe data correctly', () => {
			const lines: TcpPingData[] = [
				{
					type: 'start',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
				},
				{
					type: 'probe',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
					rtt: 10.123,
					success: true,
				},
			];

			const output = toRawTcpOutput(lines);
			expect(output).to.equal('PING example.com (93.184.216.34) on port 80.\nReply from example.com (93.184.216.34) on port 80: tcp_conn=1 time=10.1 ms');
		});

		it('should format failed probe data correctly', () => {
			const lines: TcpPingData[] = [
				{
					type: 'start',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
				},
				{
					type: 'probe',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
					rtt: -1,
					success: false,
				},
			];

			const output = toRawTcpOutput(lines);
			expect(output).to.equal('PING example.com (93.184.216.34) on port 80.\nNo reply from example.com (93.184.216.34) on port 80: tcp_conn=1');
		});

		it('should format statistics data correctly', () => {
			const lines: TcpPingData[] = [
				{
					type: 'start',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
				},
				{
					type: 'probe',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
					rtt: 10.123,
					success: true,
				},
				{
					type: 'statistics',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
					min: 10.123,
					avg: 10.123,
					max: 10.123,
					mdev: 0,
					total: 1,
					rcv: 1,
					drop: 0,
					loss: 0,
					time: 1000,
				},
			];

			const output = toRawTcpOutput(lines);

			expect(output).to.equal([
				'PING example.com (93.184.216.34) on port 80.',
				'Reply from example.com (93.184.216.34) on port 80: tcp_conn=1 time=10.1 ms',
				'',
				'--- example.com (93.184.216.34) ping statistics ---',
				'1 packets transmitted, 1 received, 0% packet loss, time 1000 ms',
				'rtt min/avg/max/mdev = 10.123/10.123/10.123/0.000 ms',
			].join('\n'));
		});

		it('should format error data correctly', () => {
			const lines: TcpPingData[] = [
				{
					type: 'error',
					message: 'DNS resolution failed',
				},
			];

			const output = toRawTcpOutput(lines);
			expect(output).to.equal('DNS resolution failed');
		});
	});

	describe('formatTcpPingResult', () => {
		it('should format successful ping results correctly', () => {
			const lines: TcpPingData[] = [
				{
					type: 'start',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
				},
				{
					type: 'probe',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
					rtt: 10.123,
					success: true,
				},
				{
					type: 'probe',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
					rtt: 15.456,
					success: true,
				},
				{
					type: 'statistics',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
					min: 10.123,
					avg: 12.789,
					max: 15.456,
					mdev: 2.667,
					total: 2,
					rcv: 2,
					drop: 0,
					loss: 0,
					time: 1000,
				},
			];

			const result = formatTcpPingResult(lines);

			expect(result.status).to.equal('finished');
			expect(result.resolvedAddress).to.equal('93.184.216.34');
			expect(result.resolvedHostname).to.equal('example.com');

			expect(result.timings).to.deep.equal([
				{ rtt: 10.1 },
				{ rtt: 15.5 },
			]);

			expect(result.stats).to.deep.equal({
				min: 10.12,
				max: 15.46,
				avg: 12.79,
				total: 2,
				rcv: 2,
				loss: 0,
				drop: 0,
			});

			expect(result.rawOutput).to.be.a('string');
		});

		it('should format failed ping results correctly', () => {
			const lines: TcpPingData[] = [
				{
					type: 'error',
					message: 'DNS resolution failed',
				},
			];

			const result = formatTcpPingResult(lines);

			expect(result.status).to.equal('failed');
			expect(result.rawOutput).to.equal('DNS resolution failed');
		});

		it('should handle partial results correctly', () => {
			const lines: TcpPingData[] = [
				{
					type: 'start',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
				},
				{
					type: 'probe',
					address: '93.184.216.34',
					hostname: 'example.com',
					port: 80,
					rtt: 10.123,
					success: true,
				},
				{
					type: 'error',
					message: 'Connection interrupted',
				},
			];

			const result = formatTcpPingResult(lines);

			expect(result.status).to.equal('failed');
			expect(result.resolvedAddress).to.equal('93.184.216.34');
		});
	});
});
