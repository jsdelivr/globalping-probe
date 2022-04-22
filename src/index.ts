import * as processTS from 'node:process';
import throng from 'throng';
import {io} from 'socket.io-client';
import cryptoRandomString from 'crypto-random-string';
import physicalCpuCount from 'physical-cpu-count';
import type {CommandInterface, MeasurementRequest} from './types.js';
import {scopedLogger} from './lib/logger.js';
import {getConfValue} from './lib/config.js';
import {apiErrorHandler} from './helper/api-error-handler.js';
import {apiConnectLocationHandler} from './helper/api-connect-handler.js';
import {dnsCmd, DnsCommand} from './command/dns-command.js';
import {pingCmd, PingCommand} from './command/ping-command.js';
import {traceCmd, TracerouteCommand} from './command/traceroute-command.js';

import {VERSION} from './constants.js';

// Run self-update checks
import './lib/updater.js';

const logger = scopedLogger('general');
const handlersMap = new Map<string, CommandInterface<any>>();

handlersMap.set('ping', new PingCommand(pingCmd));
handlersMap.set('traceroute', new TracerouteCommand(traceCmd));
handlersMap.set('dns', new DnsCommand(dnsCmd));

logger.info(`Start probe version ${VERSION} in a ${processTS.env['NODE_ENV'] ?? 'production'} mode`);

function connect() {
	const worker = {
		jobs: new Map<string, number>(),
		active: false,
	};

	const socket = io(`${getConfValue<string>('api.host')}/probes`, {
		transports: ['websocket'],
		query: {
			version: VERSION,
		},
	});

	socket
		.on('connect', () => {
			worker.active = true;
			socket.emit('probe:status:ready', {});
			logger.debug('connection to API established');
		})
		.on('disconnect', () => logger.debug('disconnected from API'))
		.on('connect_error', error => logger.error('connection to API failed', error))
		.on('api:error', apiErrorHandler)
		.on('api:connect:location', apiConnectLocationHandler)
		.on('probe:measurement:request', (data: MeasurementRequest) => {
			if (!worker.active) {
				return;
			}

			const {id: measurementId, measurement} = data;
			const testId = cryptoRandomString({length: 16, type: 'alphanumeric'});

			worker.jobs.set(measurementId, Date.now());

			logger.debug(`${measurement.type} request ${data.id} received`, data);
			socket.emit('probe:measurement:ack', {id: testId, measurementId}, async () => {
				const handler = handlersMap.get(measurement.type);
				if (!handler) {
					return;
				}

				try {
					await handler.run(socket, measurementId, testId, measurement);
					worker.jobs.delete(measurementId);
					console.log('sas:');
				} catch (error: unknown) {
					// Todo: maybe we should notify api as well
					logger.error('failed to run the measurement.', error);
				}
			});
		});

	// eslint-disable-next-line node/prefer-global/process
	process.on('SIGTERM', () => {
		worker.active = false;
		socket.emit('probe:status:not_ready', {});

		logger.debug('SIGTERM received');

		const closeInterval = setInterval(() => {
			if (worker.jobs.size === 0) {
				clearInterval(closeInterval);

				logger.debug('closing process');
				// eslint-disable-next-line node/prefer-global/process
				process.exit(0);
			}
		}, 100);
	});
}

if (processTS.env['NODE_ENV'] === 'development') {
	// Run multiple clients in dev mode for easier debugging
	throng({worker: connect, count: physicalCpuCount})
		.catch(error => {
			logger.error(error);
		});
} else {
	connect();
}
