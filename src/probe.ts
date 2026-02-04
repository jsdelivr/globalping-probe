import config from 'config';
import os from 'node:os';
import net from 'node:net';
import dns from 'node:dns';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import throng from 'throng';
import { io } from 'socket.io-client';
import physicalCpuCount from 'physical-cpu-count';
import { getFakeIp } from './lib/fake-ip.js';
import type { CommandInterface, MeasurementRequest } from './types.js';
import { loadAll as loadAllDeps } from './lib/dependencies.js';
import { apiLogsTransport, scopedLogger } from './lib/logger.js';
import { ApiTransportSettings } from './lib/api-logs-transport.js';
import { initErrorHandler } from './helper/api-error-handler.js';
import { handleTestError } from './helper/test-error-handler.js';
import { apiConnectLocationHandler } from './helper/api-connect-handler.js';
import { ipHandler } from './helper/alt-ips-client.js';
import { adoptionStatusHandler } from './helper/adoption-status-handler.js';
import { dnsCmd, DnsCommand } from './command/dns-command.js';
import { pingCmd, PingCommand } from './command/ping-command.js';
import { traceCmd, TracerouteCommand } from './command/traceroute-command.js';
import { mtrCmd, MtrCommand } from './command/mtr-command.js';
import { HttpCommand } from './command/http-command.js';
import { FakePingCommand } from './command/fake/fake-ping-command.js';
import { FakeMtrCommand } from './command/fake/fake-mtr-command.js';
import { run as runStatsAgent } from './lib/stats/client.js';
import { initStatusManager } from './lib/status-manager.js';
import { logAdoptionCode } from './lib/log-adoption-code.js';
import { getAvailableDiskSpace, getTotalDiskSize, looksLikeV1HardwareDevice } from './lib/util.js';
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
if (looksLikeV1HardwareDevice()) {
	process.env['GP_HOST_HW'] = 'true';
	process.env['GP_HOST_DEVICE'] = 'v1';
}

// Run self-update checks
import './lib/updater.js';

// Run scheduled restart
import './lib/restart.js';

await loadAllDeps();

const logger = scopedLogger('general');
const handlersMap = new Map<string, CommandInterface<unknown>>();
const probeUuid = process.env['GP_PROBE_UUID'] || randomUUID();
const logMeasurementResults = process.env['GP_LOG_MEASUREMENT_RESULTS'] === 'true';

handlersMap.set('ping', process.env['FAKE_COMMANDS'] ? new FakePingCommand() : new PingCommand());
handlersMap.set('mtr', process.env['FAKE_COMMANDS'] ? new FakeMtrCommand() : new MtrCommand(mtrCmd));
handlersMap.set('traceroute', new TracerouteCommand(traceCmd));
handlersMap.set('dns', new DnsCommand(dnsCmd));
handlersMap.set('http', new HttpCommand());

if (process.env['GP_HOST_FIRMWARE']) {
	logger.info(`Hardware probe running firmware version ${process.env['GP_HOST_FIRMWARE'].substring(1)}.`);
}

logger.info(`Starting probe version ${VERSION} in a ${process.env['NODE_ENV'] ?? 'production'} mode with UUID ${probeUuid.substring(0, 8)}.`);

function connect (workerId?: number) {
	const worker = {
		jobs: new Map<string, number>(),
		jobsInterval: setInterval(() => {
			for (const [ key, value ] of worker.jobs) {
				if (Date.now() >= (value + 30_000)) {
					worker.jobs.delete(key);
				}
			}
		}, 10_000),
	};

	const socket = io(`${config.get<string>('api.host')}/probes`, {
		transports: [ 'websocket' ],
		reconnectionDelay: 4000,
		reconnectionDelayMax: 8000,
		randomizationFactor: 0.5,
		query: {
			version: VERSION,
			nodeVersion: process.version,
			totalMemory: os.totalmem(),
			totalDiskSize: getTotalDiskSize(),
			availableDiskSpace: getAvailableDiskSpace(),
			uuid: probeUuid,
			isHardware: process.env['GP_HOST_HW'],
			hardwareDevice: process.env['GP_HOST_DEVICE'],
			hardwareDeviceFirmware: process.env['GP_HOST_FIRMWARE'],
			adoptionToken: process.env['GP_ADOPTION_TOKEN'],
			...(process.env['FAKE_IP_FIRST_OCTETS'] && { fakeIp: getFakeIp(workerId) }),
		},
	});

	runStatsAgent(socket, worker);
	apiLogsTransport.setSocket(socket);

	const statusManager = initStatusManager(socket, pingCmd);
	const errorHandler = initErrorHandler(socket);

	socket
		.on('probe:sigkill', () => {
			logger.info(`Probe restart requested by the API. Exiting...`);
			process.exit();
		})
		.on('connect', async () => {
			logger.debug('Connection to API established.');
			statusManager.sendStatus();
			await statusManager.start();
		})
		.on('disconnect', errorHandler.handleDisconnect)
		.on('connect_error', errorHandler.connectError)
		.on('api:connect:location', apiConnectLocationHandler(socket))
		.on('api:connect:adoption', adoptionStatusHandler(socket))
		.on('api:connect:ip', ipHandler(socket))
		.on('probe:measurement:request', (data: MeasurementRequest) => {
			const status = statusManager.getStatus();

			if (status !== 'ready') {
				logger.warn(`Measurement was sent to probe with ${status} status.`);
				return;
			}

			const { measurementId, testId, measurement } = data;

			logger.debug(`${measurement.type} request ${measurementId} received.`);

			socket.emit('probe:measurement:ack', null, async () => {
				const handler = handlersMap.get(measurement.type);

				if (!handler) {
					return;
				}

				worker.jobs.set(measurementId, Date.now());

				try {
					const out = await handler.run(socket, measurementId, testId, measurement);
					logMeasurementResults && logger.silly(`${measurement.type} request ${measurementId} result: ${JSON.stringify(out)}`);
				} catch (error: unknown) {
					handleTestError(error, socket, measurementId, testId);
				} finally {
					worker.jobs.delete(measurementId);
				}
			});
		})
		.on('probe:adoption:code', logAdoptionCode)
		.on('api:logs-transport:set', (data: ApiTransportSettings) => apiLogsTransport.updateSettings(data));

	process.on('SIGTERM', () => {
		logger.info('SIGTERM received.');

		statusManager.stop('sigterm');

		const closeTimeout = setTimeout(() => {
			logger.warn('SIGTERM timeout. Force closing.');
			forceCloseProcess();
		}, 60_000);

		const closeInterval = setInterval(() => {
			if (worker.jobs.size === 0) {
				clearTimeout(closeTimeout);
				forceCloseProcess();
			}
		}, 100);

		const forceCloseProcess = () => {
			clearInterval(closeInterval);
			clearInterval(worker.jobsInterval);

			logger.debug('Closing process.');
			process.exit(0);
		};
	});
}

if (process.env['NODE_ENV'] === 'development') {
	// Run multiple clients in dev mode for easier debugging
	throng({
		worker: workerId => connect(workerId),
		count: Number(process.env['PROBES_COUNT']) || physicalCpuCount,
		grace: 0,
	})
		.catch((error) => {
			logger.error(error);
		});
} else {
	connect();
}
