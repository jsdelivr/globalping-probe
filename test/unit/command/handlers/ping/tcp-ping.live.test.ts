import { expect } from 'chai';
import { tcpPing, tcpPingSingle, formatTcpPingResult } from '../../../../../src/command/handlers/ping/tcp-ping.js';

describe('TCP Ping Integration Tests', () => {
	const RELIABLE_HOST = 'google.com';
	const RELIABLE_PORT = 80;
	const GITHUB_HOST = 'github.com';
	const GITHUB_PORT = 443;
	const NONEXISTENT_HOST = 'nonexistent-domain-that-should-not-resolve.com';
	const CLOSED_PORT = 9999; // A port that's likely to be closed
	const INTERVAL = 100;
	const TIMEOUT = 1000;
	const PACKETS = 2;

	describe('tcpPingSingle', () => {
		it('should successfully ping a reliable host on an open port', async () => {
			const result = await tcpPingSingle(RELIABLE_HOST, RELIABLE_HOST, RELIABLE_PORT, 4, TIMEOUT);

			expect(result.type).to.equal('probe');

			if (result.type === 'probe') {
				expect(result.success).to.be.true;
				expect(result.hostname).to.equal(RELIABLE_HOST);
				expect(result.port).to.equal(RELIABLE_PORT);
				expect(result.rtt).to.be.a('number');
				expect(result.rtt).to.be.greaterThan(0);
				expect(result.rtt).to.be.lessThan(2000); // Reasonable RTT for a reliable host
			}
		});

		it('should fail to ping a nonexistent host', async () => {
			const result = await tcpPingSingle(NONEXISTENT_HOST, NONEXISTENT_HOST, RELIABLE_PORT, 4, TIMEOUT);

			expect(result.type).to.equal('error');

			if (result.type === 'error') {
				expect(result.message).to.be.a('string');
				expect(result.message.length).to.be.greaterThan(0);
			}
		});

		it('should fail to ping a reliable host on a closed port', async () => {
			const result = await tcpPingSingle(RELIABLE_HOST, RELIABLE_HOST, CLOSED_PORT, 4, TIMEOUT);

			expect(result).to.include({
				type: 'probe',
				success: false,
			});
		});
	});

	describe('tcpPing', () => {
		it('should successfully ping a reliable host multiple times', async () => {
			const options = {
				target: RELIABLE_HOST,
				port: RELIABLE_PORT,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have at least PACKETS + 2 (1 start + PACKETS probes + 1 statistics)
			expect(results.length).to.be.at.least(PACKETS + 2);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(PACKETS);
				expect(statsData.rcv).to.be.at.least(1); // At least one packet should succeed
				expect(statsData.loss).to.be.a('number');

				// Check reasonable RTT values if we have successful probes
				if (statsData.rcv > 0) {
					expect(statsData.min).to.be.a('number');
					expect(statsData.max).to.be.a('number');
					expect(statsData.avg).to.be.a('number');
					expect(statsData.min).to.be.greaterThan(0);
					expect(statsData.max).to.be.lessThan(2000); // Reasonable max RTT
				}
			}
		});

		it('should handle a nonexistent host', async () => {
			const options = {
				target: NONEXISTENT_HOST,
				port: RELIABLE_PORT,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have an error result
			expect(results.length).to.be.at.least(1);
			expect(results[0].type).to.equal('error');

			if (results[0].type === 'error') {
				expect(results[0].message).to.be.a('string');
				expect(results[0].message.length).to.be.greaterThan(0);
			}
		});

		it('should handle a reliable host with a closed port', async () => {
			const options = {
				target: RELIABLE_HOST,
				port: CLOSED_PORT,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have PACKETS + 1 results (PACKETS probes + 1 statistics)
			expect(results.length).to.be.at.least(PACKETS + 1);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(PACKETS);
				// Most or all packets should fail for a closed port
				expect(statsData.drop).to.be.at.least(1);
			}
		});

		it('should successfully ping GitHub on HTTPS port', async () => {
			const options = {
				target: GITHUB_HOST,
				port: GITHUB_PORT,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);

			// Should have at least PACKETS + 1 results (PACKETS probes + 1 statistics)
			expect(results.length).to.be.at.least(PACKETS + 1);

			// Check statistics
			const statsData = results.find(r => r.type === 'statistics');
			expect(statsData).to.exist;

			if (statsData && statsData.type === 'statistics') {
				expect(statsData.total).to.equal(PACKETS);
				expect(statsData.rcv).to.be.at.least(1); // At least one packet should succeed

				// Check reasonable RTT values if we have successful probes
				if (statsData.rcv > 0) {
					expect(statsData.min).to.be.a('number');
					expect(statsData.max).to.be.a('number');
					expect(statsData.avg).to.be.a('number');
					expect(statsData.min).to.be.greaterThan(0);
					expect(statsData.max).to.be.lessThan(2000); // Reasonable max RTT
				}
			}
		});
	});

	describe('formatTcpPingResult', () => {
		it('should correctly format successful ping results', async () => {
			const options = {
				target: RELIABLE_HOST,
				port: RELIABLE_PORT,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);
			const formatted = formatTcpPingResult(results);

			expect(formatted.status).to.equal('finished');
			expect(formatted.resolvedHostname).to.equal(RELIABLE_HOST);
			expect(formatted.resolvedAddress).to.be.a('string');
			expect(formatted.timings).to.be.an('array');
			expect(formatted.stats).to.be.an('object');
			expect(formatted.rawOutput).to.be.a('string');

			// Check stats
			expect(formatted.stats.total).to.equal(PACKETS);
			expect(formatted.stats.rcv).to.be.at.least(1);
			expect(formatted.stats.min).to.be.a('number');
			expect(formatted.stats.max).to.be.a('number');
			expect(formatted.stats.avg).to.be.a('number');
		});

		it('should correctly format failed ping results', async () => {
			const options = {
				target: NONEXISTENT_HOST,
				port: RELIABLE_PORT,
				packets: PACKETS,
				timeout: TIMEOUT,
				interval: INTERVAL,
				ipVersion: 4 as const,
			};

			const results = await tcpPing(options);
			const formatted = formatTcpPingResult(results);

			expect(formatted.status).to.equal('failed');
			expect(formatted.rawOutput).to.be.a('string');
		});
	});
});
