import net from 'node:net';
import dns from 'node:dns';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import fs from 'node:fs';
import readline from 'node:readline';
import type { CommandInterface } from './types.js';
import { scopedLogger } from './lib/logger.js';
import { dnsCmd, DnsCommand } from './command/dns-command.js';
import { PingCommand } from './command/ping-command.js';
import { traceCmd, TracerouteCommand } from './command/traceroute-command.js';
import { mtrCmd, MtrCommand } from './command/mtr-command.js';
import { HttpCommand } from './command/http-command.js';
import { httpCmd, HttpCommand as HttpCommandOld } from './command/http-command-old.js';
import { FakePingCommand } from './command/fake/fake-ping-command.js';
import { FakeMtrCommand } from './command/fake/fake-mtr-command.js';
import { VERSION } from './constants.js';

dns.setDefaultResultOrder('ipv4first');

// The default value (250 ms) is too low for clients that are far from our servers
// See https://github.com/nodejs/node/issues/52216 for more details
// Supported (but also needed) only since node v18.18.0
if (net.setDefaultAutoSelectFamilyAttemptTimeout) {
	net.setDefaultAutoSelectFamilyAttemptTimeout(1000);
}

// Set the expected variables on HW probes with older firmware
// https://github.com/jsdelivr/globalping-hwprobe/issues/27
// https://github.com/jsdelivr/globalping-probe/issues/206

// Run self-update checks
import './lib/updater.js';

// Run scheduled restart
import './lib/restart.js';

// await loadAllDeps();

const logger = scopedLogger('general');
const handlersMap = new Map<string, CommandInterface<unknown>>();
const probeUuid = process.env['GP_PROBE_UUID'] || randomUUID();

handlersMap.set('ping', process.env['FAKE_COMMANDS'] ? new FakePingCommand() : new PingCommand());
handlersMap.set('mtr', process.env['FAKE_COMMANDS'] ? new FakeMtrCommand() : new MtrCommand(mtrCmd));
handlersMap.set('traceroute', new TracerouteCommand(traceCmd));
handlersMap.set('dns', new DnsCommand(dnsCmd));
handlersMap.set('http', new HttpCommand());
handlersMap.set('http-old', new HttpCommandOld(httpCmd));

if (process.env['GP_HOST_FIRMWARE']) {
	logger.info(`Hardware probe running firmware version ${process.env['GP_HOST_FIRMWARE'].substring(1)}.`);
}

logger.info(`Starting probe version ${VERSION} in a ${process.env['NODE_ENV'] ?? 'production'} mode with UUID ${probeUuid.substring(0, 8)}.`);

// DNS: несуществующий домен
// const _dnsFail = {
// 	type: 'http' as const,
// 	target: 'nonexistent.invalid',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// // DNS: private IP
// const _dnsPrivate = {
// 	type: 'http' as const,
// 	target: 'localhost',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	port: 8443,
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// // TCP: connection refused (неверный порт)
// const _tcpRefused = {
// 	type: 'http' as const,
// 	target: 'google.com',
// 	inProgressUpdates: false,
// 	protocol: 'HTTP',
// 	port: 12345,
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// // TCP: timeout (non-routable IP)
// const _tcpTimeout = {
// 	type: 'http' as const,
// 	target: '10.255.255.1',
// 	inProgressUpdates: false,
// 	protocol: 'HTTP',
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// // TLS: HTTP на HTTPS порт (не TLS)
// const _tlsWrongProtocol = {
// 	type: 'http' as const,
// 	target: 'google.com',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	port: 80,
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// // TLS: expired cert
// const tlsExpired = {
// 	type: 'http' as const,
// 	target: 'expired.badssl.com',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// // HTTP: custom Host header (IP + Host)
// const _customHost = {
// 	type: 'http' as const,
// 	target: '142.250.185.14',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	request: { method: 'GET', path: '/', query: '', host: 'asdfasfd.com' },
// 	ipVersion: 4,
// };

// // HTTP2: успешный запрос
// const _http2Success = {
// 	type: 'http' as const,
// 	target: 'httpbin.org',
// 	inProgressUpdates: false,
// 	protocol: 'HTTP2',
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// const _http404 = {
// 	type: 'http' as const,
// 	target: 'yarmosh.by',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	request: { method: 'GET', path: '/asdfasdfasdf', query: '' },
// 	ipVersion: 4,
// };

// const _bigResponse = {
// 	type: 'http' as const,
// 	target: 'cdn.jsdelivr.net',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	request: {
// 		method: 'GET',
// 		path: '/npm/jquery',
// 		query: '',
// 		headers: {
// 			'Accept-Encoding': '',
// 		},
// 	},
// 	ipVersion: 4,
// };

// const _httpOptions = {
// 	type: 'http' as const,
// 	target: 'postman-echo.com',
// 	inProgressUpdates: false,
// 	protocol: 'HTTP',
// 	request: {
// 		method: 'GET',
// 		path: '/headers',
// 		query: '',
// 		headers: {
// 			'X-Custom-Header': 'test-value',
// 			'X-Another': 'another-value',
// 		},
// 	},
// 	ipVersion: 4,
// };

// // HTTP: успешный запрос
// const _httpSuccess = {
// 	type: 'http' as const,
// 	target: 'jsdelivr.com',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// 	resolver: '1.1.1.1',
// 	resolver: 'cloudflare-dns.com',
// };

// const _http1OnlyLocal = {
// 	type: 'http' as const,
// 	target: 'localhost',
// 	inProgressUpdates: false,
// 	protocol: 'HTTP2',
// 	port: 8444,
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// const _http1OnlyRemote = {
// 	type: 'http' as const,
// 	target: 'www.zenlayer.com',
// 	// target: 'httpforever.com',
// 	inProgressUpdates: false,
// 	protocol: 'HTTP2',
// 	request: { method: 'GET', path: '/', query: '' },
// 	ipVersion: 4,
// };

// const _httpCodes = {
// 	type: 'http' as const,
// 	target: 'tools-httpstatus.pickup-services.com',
// 	inProgressUpdates: false,
// 	protocol: 'HTTPS',
// 	request: { method: 'GET', path: '/505', query: '' },
// 	ipVersion: 4,
// };

const testData = JSON.parse(fs.readFileSync('r.json', 'utf-8')) as Record<string, unknown>;
const inputs = Object.entries(testData).map(([ key, value ]) => ({ key, value }));

const oldHttpHandler = handlersMap.get('http-old')!;
const newHttpHandler = handlersMap.get('http')!;


const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

const waitForEnter = () => new Promise<void>((resolve) => {
	rl.question('\nPress Enter to continue...', () => resolve());
});

void (async () => {
	await new Promise(resolve => setTimeout(resolve, 1000));

	for (let i = 0; i < inputs.length; i++) {
		const item = inputs[i];

		if (!item) {
			continue;
		}

		const { key, value } = item;
		console.log(`\n${'='.repeat(80)}`);
		console.log(`Test ${i + 1}/${inputs.length}: ${key}`);
		console.log(`${'='.repeat(80)}`);
		console.log('Input:', JSON.stringify(value, null, 2));

		try {
			const newData = await newHttpHandler.run({ emit: () => ({}) } as never, 'wktl4ti3665LCugn0001zQL6', '0', value);
			const oldData = await oldHttpHandler.run({ emit: () => ({}) } as never, 'wktl4ti3665LCugn0001zQL6', '0', value);
			fs.writeFileSync('new-data.json', JSON.stringify(newData, null, 2));
			fs.writeFileSync('old-data.json', JSON.stringify(oldData, null, 2));
			console.log('\nResult saved to new-data.json and old-data.json');
		} catch (err) {
			console.error('Error:', err);
		}

		if (i < inputs.length - 1) {
			await waitForEnter();
		}
	}

	console.log('\n✓ All tests completed');
	rl.close();
	process.exit(0);
})();

// ================  MEMORY LEAK TEST =============
// const total = 1000;
// const concurrency = 10;
// console.log(`\n=== ${isOld ? 'OLD' : 'NEW'} version ===`);
// global.gc?.();

// for (let i = 0; i < total; i += concurrency) {
// 	const batch = Array.from({ length: concurrency }, (_, j) => httpHandler.run(`test-${i + j}`, '0', bigResponse));
// 	await Promise.all(batch);

// 	if ((i + concurrency) % 50 === 0) {
// 		global.gc?.();
// 		const mem = process.memoryUsage();
// 		console.log(`${i + concurrency}: Heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB, Ext=${(mem.external / 1024 / 1024).toFixed(1)}MB`);
// 	}
// }

// process.exit(0);
