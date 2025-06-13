import net from 'node:net';
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as td from 'testdouble';

// This must remain type-only
import type * as tcpPingModule from '../../../../../src/command/handlers/ping/tcp-ping.js';

/**
 * TCP Server factory that creates servers with different behaviors
 */
class TcpServerFactory {
	private servers: net.Server[] = [];

	async createServer (): Promise<number> {
		const server = net.createServer();
		const port = await this.startServer(server);
		return port;
	}

	/**
	 * Creates a port that will refuse connections
	 */
	async createRefusedPort (): Promise<number> {
		// Create a server just to get an available port
		const server = net.createServer();
		const port = await this.startServer(server);

		// Stop the server to make the port refuse connections
		await this.stopServer(server);

		// Remove from our list since we're not keeping it running
		this.servers = this.servers.filter(s => s !== server);

		return port;
	}

	/**
	 * Starts a server on a random available port
	 */
	private startServer (server: net.Server): Promise<number> {
		return new Promise((resolve, reject) => {
			server.listen(0, '127.0.0.1', () => {
				const address = server.address() as net.AddressInfo;
				const port = address.port;
				this.servers.push(server);
				resolve(port);
			});

			server.on('error', (err) => {
				reject(err);
			});
		});
	}

	/**
	 * Stops a specific server
	 */
	private stopServer (server: net.Server): Promise<void> {
		return new Promise((resolve) => {
			server.close(() => {
				resolve();
			});
		});
	}

	/**
	 * Stops all servers
	 */
	async stopAllServers (): Promise<void> {
		const promises = this.servers.map((server) => {
			return this.stopServer(server);
		});

		await Promise.all(promises);
		this.servers = [];
	}
}

describe('TCP Ping Local Servers Tests', () => {
	const serverFactory = new TcpServerFactory();
	const HOST = '127.0.0.1';
	const TIMEOUT = 50;
	const PACKETS = 3;
	const INTERVAL = 20;

	// Ports for different server types
	let openPort: number;
	let refusedPort: number;

	let sandbox: sinon.SinonSandbox;
	let tcpPingSingle: typeof tcpPingModule.tcpPingSingle;
	let tcpPing: typeof tcpPingModule.tcpPing;
	let formatTcpPingResult: typeof tcpPingModule.formatTcpPingResult;
	let toRawTcpOutput: typeof tcpPingModule.toRawTcpOutput;
	let serverDelayFn = () => 0;

	const setServerDelay = (delay: number | (() => number)) => {
		if (typeof delay === 'function') {
			serverDelayFn = delay;
			return;
		}

		serverDelayFn = () => delay;
	};


	before(async () => {
		openPort = await serverFactory.createServer();
		refusedPort = await serverFactory.createRefusedPort();
		sandbox = sinon.createSandbox();

		// We can't add a delay directly into the TCP handshake, so we emulate that by adding a delay on the emit() calls.
		const emit = net.Socket.prototype.emit;
		sinon.stub(net.Socket.prototype, 'emit').callsFake(function (name: string, ...args) {
			if (![ 'connect' ].includes(name)) {
				return emit.call(this, name, ...args);
			}

			return setTimeout(() => {
				emit.call(this, name, ...args);
			}, serverDelayFn());
		});

		await td.replaceEsm('node:net', {
			...net,
			Socket: net.Socket,
		});

		const tcpPingModule = await import('../../../../../src/command/handlers/ping/tcp-ping.js');
		tcpPingSingle = tcpPingModule.tcpPingSingle;
		tcpPing = tcpPingModule.tcpPing;
		formatTcpPingResult = tcpPingModule.formatTcpPingResult;
		toRawTcpOutput = tcpPingModule.toRawTcpOutput;
	});

	afterEach(() => {
		setServerDelay(0);
		sandbox.reset();
	});

	after(async () => {
		await serverFactory.stopAllServers();
		td.reset();
	});

	describe('tcpPingSingle', () => {
		it('should successfully ping a fast server with low RTT', async () => {
			const result = await tcpPingSingle(HOST, HOST, openPort, 4, TIMEOUT);

			expect(result.type).to.equal('probe');

			if (result.type === 'probe') {
				expect(result.success).to.be.true;
				expect(result.address).to.equal(HOST);
				expect(result.hostname).to.equal(HOST);
				expect(result.port).to.equal(openPort);
				expect(result.rtt).to.be.a('number').within(0, 10);
			}
		});

		it('should successfully ping a slow server with higher RTT', async () => {
			setServerDelay(25);
			const result = await tcpPingSingle(HOST, HOST, openPort, 4, TIMEOUT);

			expect(result.type).to.equal('probe');

			if (result.type === 'probe') {
				expect(result.success).to.be.true;
				expect(result.address).to.equal(HOST);
				expect(result.hostname).to.equal(HOST);
				expect(result.port).to.equal(openPort);
				expect(result.rtt).to.be.a('number').greaterThan(20);
			}
		});

		it('should timeout when server does not respond', async () => {
			setServerDelay(100);
			const result = await tcpPingSingle(HOST, HOST, openPort, 4, TIMEOUT);

			expect(result.type).to.equal('probe');

			if (result.type === 'probe') {
				expect(result.success).to.be.false;
				expect(result.address).to.equal(HOST);
				expect(result.hostname).to.equal(HOST);
				expect(result.port).to.equal(openPort);
			}
		});

		it('should handle connection refused', async () => {
			const result = await tcpPingSingle(HOST, HOST, refusedPort, 4, TIMEOUT);

			expect(result.type).to.equal('probe');

			if (result.type === 'probe') {
				expect(result.success).to.be.false;
				expect(result.address).to.equal(HOST);
				expect(result.hostname).to.equal(HOST);
				expect(result.port).to.equal(refusedPort);
			}
		});
	});

	describe('tcpPing', () => {
		it('should successfully ping a fast server multiple times', async () => {
			const options = {
				target: HOST,
				port: openPort,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have PACKETS + 2 results (1 start + PACKETS probes + 1 statistics)
			expect(results.length).to.equal(PACKETS + 2);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(PACKETS);
				expect(statsData.rcv).to.equal(PACKETS);
				expect(statsData.drop).to.equal(0);
				expect(statsData.loss).to.equal(0);

				// Check reasonable RTT values
				expect(statsData.min).to.be.a('number').within(0, 10);
				expect(statsData.max).to.be.a('number').within(0, 10);
				expect(statsData.avg).to.be.a('number').within(0, 10);
			}
		});

		it('should successfully ping a slow server multiple times', async () => {
			setServerDelay(40);

			const options = {
				target: HOST,
				port: openPort,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have PACKETS + 2 results (1 start + PACKETS probes + 1 statistics)
			expect(results.length).to.equal(PACKETS + 2);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(PACKETS);
				expect(statsData.rcv).to.equal(PACKETS);
				expect(statsData.drop).to.equal(0);
				expect(statsData.loss).to.equal(0);

				// Check reasonable RTT values
				expect(statsData.min).to.be.a('number').greaterThan(30);
				expect(statsData.max).to.be.a('number').greaterThan(30);
				expect(statsData.avg).to.be.a('number').greaterThan(30);

				// Check new pings start at regular intervals regardless of previous ping completion
				expect(statsData.time).to.be.below(90);
			}
		});

		it('should handle mixed response times', async () => {
			let delayCalls = 0;
			setServerDelay(() => delayCalls++ % 2 ? 40 : 0);

			const options = {
				target: HOST,
				port: openPort,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have packets + 2 results (1 start + PACKETS probes + 1 statistics)
			expect(results.length).to.equal(options.packets + 2);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(options.packets);
				expect(statsData.rcv).to.equal(options.packets);
				expect(statsData.drop).to.equal(0);
				expect(statsData.loss).to.equal(0);

				// Check reasonable RTT values
				expect(statsData.min).to.be.a('number').within(0, 10);
				expect(statsData.max).to.be.a('number').greaterThan(30);
				expect(statsData.avg).to.be.a('number');
			}
		});

		it('should handle mixed responses and timeouts', async () => {
			let delayCalls = 0;
			setServerDelay(() => delayCalls++ % 2 ? 150 : 0);

			const options = {
				target: HOST,
				port: openPort,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have packets + 2 results (1 start + PACKETS probes + 1 statistics)
			expect(results.length).to.equal(options.packets + 2);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(options.packets);
				expect(statsData.rcv).to.equal(2);
				expect(statsData.drop).to.equal(1);
				expect(statsData.loss).to.be.closeTo(33.33, .1);

				// Check reasonable RTT values
				expect(statsData.min).to.be.a('number').within(0, 10);
				expect(statsData.max).to.be.a('number').within(0, 10);
				expect(statsData.avg).to.be.a('number').within(0, 10);
			}
		});

		it('should handle timeouts', async () => {
			setServerDelay(100);

			const options = {
				target: HOST,
				port: openPort,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have PACKETS + 2 results (1 start + PACKETS probes + 1 statistics)
			expect(results.length).to.equal(PACKETS + 2);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(PACKETS);
				expect(statsData.rcv).to.equal(0);
				expect(statsData.drop).to.equal(PACKETS);
				expect(statsData.loss).to.equal(100);
				expect(statsData.min).to.be.undefined;
				expect(statsData.max).to.be.undefined;
				expect(statsData.avg).to.be.undefined;

				// Check new pings start at regular intervals regardless of previous ping completion
				expect(statsData.time).to.be.below(220);
			}
		});

		it('should handle connection refused', async () => {
			const options = {
				target: HOST,
				port: refusedPort,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have PACKETS + 2 results (1 start + PACKETS probes + 1 statistics)
			expect(results.length).to.equal(PACKETS + 2);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(PACKETS);
				expect(statsData.rcv).to.equal(0);
				expect(statsData.drop).to.equal(PACKETS);
				expect(statsData.loss).to.equal(100);
				expect(statsData.min).to.be.undefined;
				expect(statsData.max).to.be.undefined;
				expect(statsData.avg).to.be.undefined;
			}
		});

		it('should handle IP address targets without DNS resolution', async () => {
			const options = {
				target: HOST,
				port: openPort,
				packets: 1,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const resolver = sandbox.stub();
			const results = await tcpPing(options, resolver);

			expect(resolver.callCount).to.equal(0);

			const errorData = results.find(r => r.type === 'error');
			expect(errorData).to.not.exist;
		});

		it('should resolve hostnames using a DNS lookup and fail on private IPs', async () => {
			const options = {
				target: 'example.com',
				port: openPort,
				packets: 1,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const resolver = sandbox.stub().returns([ HOST ]);
			const results = await tcpPing(options, resolver);

			expect(resolver.callCount).to.equal(1);

			const errorData = results.find(r => r.type === 'error');

			expect(errorData).to.deep.equal({
				type: 'error',
				message: 'Private IP ranges are not allowed.',
			});
		});
	});

	describe('toRawTcpOutput', () => {
		it('should format start data correctly', () => {
			const lines: tcpPingModule.TcpPingData[] = [
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
			const lines: tcpPingModule.TcpPingData[] = [
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
			const lines: tcpPingModule.TcpPingData[] = [
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
			const lines: tcpPingModule.TcpPingData[] = [
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
			const lines: tcpPingModule.TcpPingData[] = [
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
			const lines: tcpPingModule.TcpPingData[] = [
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
			const lines: tcpPingModule.TcpPingData[] = [
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
			const lines: tcpPingModule.TcpPingData[] = [
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
