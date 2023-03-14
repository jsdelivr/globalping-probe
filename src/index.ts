import process from 'node:process';
import throng from 'throng';
import {io} from 'socket.io-client';
import cryptoRandomString from 'crypto-random-string';
import physicalCpuCount from 'physical-cpu-count';
import type {CommandInterface, MeasurementRequest} from './types.js';
import {loadAll as loadAllDeps} from './lib/dependencies.js';
import {scopedLogger} from './lib/logger.js';
import {getConfValue} from './lib/config.js';
import {apiErrorHandler} from './helper/api-error-handler.js';
import {apiConnectLocationHandler} from './helper/api-connect-handler.js';
import {dnsCmd, DnsCommand} from './command/dns-command.js';
import {pingCmd, PingCommand} from './command/ping-command.js';
import {traceCmd, TracerouteCommand} from './command/traceroute-command.js';
import {mtrCmd, MtrCommand} from './command/mtr-command.js';
import {httpCmd, HttpCommand} from './command/http-command.js';
import {run as runStatsAgent} from './lib/stats/client.js';
import {initStatusManager} from './lib/status-manager.js';
import {VERSION} from './constants.js';

// Run self-update checks
import './lib/updater.js';

// Run scheduled restart
import './lib/restart.js';

await loadAllDeps();

const logger = scopedLogger('general');
const handlersMap = new Map<string, CommandInterface<any>>();

const fatalConnectErrors = [
	'failed to collect probe metadata',
	'vpn detected',
];

handlersMap.set('ping', new PingCommand(pingCmd));
handlersMap.set('traceroute', new TracerouteCommand(traceCmd));
handlersMap.set('mtr', new MtrCommand(mtrCmd));
handlersMap.set('dns', new DnsCommand(dnsCmd));
handlersMap.set('http', new HttpCommand(httpCmd));

logger.info(`Start probe version ${VERSION} in a ${process.env['NODE_ENV'] ?? 'production'} mode`);

function connect() {
	const worker = {
		jobs: new Map<string, number>(),
		jobsInterval: setInterval(() => {
			for (const [key, value] of worker.jobs) {
				if (Date.now() >= (value + 30_000)) {
					worker.jobs.delete(key);
				}
			}
		}, 10_000),
	};

	const socket = io(`${getConfValue<string>('api.host')}/probes`, {
		transports: ['websocket'],
		reconnectionDelay: 100,
		reconnectionDelayMax: 500,
		query: {
			version: VERSION,
		},
	});

	runStatsAgent(socket, worker);
	const statusManager = initStatusManager(socket, pingCmd);

	socket
		.on('probe:sigkill', () => {
			logger.debug('probe:sigkill requested. Killing the probe.');
			/* eslint-disable-next-line unicorn/no-process-exit */
			process.exit();
		})
		.on('connect', () => {
			statusManager.sendStatus();
			logger.debug('connection to API established');
		})
		.on('disconnect', (reason: string): void => {
			logger.debug(`disconnected from API: (${reason})`);
			if (reason === 'io server disconnect') {
				socket.connect();
			}
		})
		.on('connect_error', error => {
			logger.error('connection to API failed:', error);

			const isFatalError = fatalConnectErrors.some(fatalError => error.message.startsWith(fatalError));

			if (isFatalError) {
				// At that stage socket.connected=false already,
				// but we want to stop reconnections for fatal errors
				socket.disconnect();
			}

			if (error.message.startsWith('invalid probe version')) {
				logger.debug('Detected outdated probe. Restarting.');
				/* eslint-disable-next-line unicorn/no-process-exit */
				process.exit();
			}
		})
		.on('api:error', apiErrorHandler)
		.on('api:connect:location', apiConnectLocationHandler(socket))
		.on('probe:measurement:request', (data: MeasurementRequest) => {
			const status = statusManager.getStatus();
			if (status !== 'ready') {
				logger.warn(`measurement was sent to probe with ${status} status`);
				return;
			}

			const {id: measurementId, measurement} = data;
			const testId = cryptoRandomString({length: 16, type: 'alphanumeric'});

			logger.debug(`${measurement.type} request ${data.id} received`);
			socket.emit('probe:measurement:ack', {id: testId, measurementId}, async () => {
				const handler = handlersMap.get(measurement.type);
				if (!handler) {
					return;
				}

				worker.jobs.set(measurementId, Date.now());

				try {
					await handler.run(socket, measurementId, testId, measurement);
					worker.jobs.delete(measurementId);
				} catch (error: unknown) {
					// Todo: maybe we should notify api as well
					logger.error('failed to run the measurement.', error);
					worker.jobs.delete(measurementId);
				}
			});
		});

	process.on('SIGTERM', () => {
		logger.debug('SIGTERM received');

		statusManager.stop('sigterm');

		const closeTimeout = setTimeout(() => {
			logger.debug('SIGTERM timeout. Force close.');
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

			logger.debug('closing process');
			process.exit(0);
		};
	});
}

if (process.env['NODE_ENV'] === 'development') {
	// Run multiple clients in dev mode for easier debugging
	throng({worker: connect, count: physicalCpuCount})
		.catch(error => { // eslint-disable-line unicorn/prefer-top-level-await
			logger.error(error);
		});
} else {
	connect();
}
