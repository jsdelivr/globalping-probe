import * as process from 'node:process';
import throng from 'throng';
import {io} from 'socket.io-client';
import cryptoRandomString from 'crypto-random-string';
import physicalCpuCount from 'physical-cpu-count';
import type {CommandInterface, MeasurementRequest} from './types.js';
import {scopedLogger} from './lib/logger.js';
import {pingCmd, PingCommand} from './command/ping-command.js';
import {traceCmd, TracerouteCommand} from './command/traceroute-command.js';
import {getConfValue} from './lib/config.js';

const logger = scopedLogger('general');
const handlersMap = new Map<string, CommandInterface<any>>();

handlersMap.set('ping', new PingCommand(pingCmd));
handlersMap.set('traceroute', new TracerouteCommand(traceCmd));

logger.info(`Start probe in a ${process.env['NODE_ENV'] ?? 'production'} mode`);

function connect() {
	const socket = io(`${getConfValue<string>('api.host')}/probes`, {
		transports: ['websocket'],
	});

	socket
		.on('connect', () => logger.debug('connection to API established'))
		.on('disconnect', () => logger.debug('disconnected from API'))
		.on('connect_error', error => logger.error('connection to API failed', error))
		.on('probe:measurement:request', (data: MeasurementRequest) => {
			const {id: measurementId, measurement} = data;
			const testId = cryptoRandomString({length: 16, type: 'alphanumeric'});

			logger.debug(`${measurement.type} request ${data.id} received`, data);
			socket.emit('probe:measurement:ack', {id: testId, measurementId}, async () => {
				const handler = handlersMap.get(measurement.type);
				if (!handler) {
					return;
				}

				try {
					await handler.run(socket, measurementId, testId, measurement);
				} catch (error: unknown) {
					// Todo: maybe we should notify api as well
					logger.error('failed to run the measurement.', error);
				}
			});
		});
}

throng({worker: connect, count: physicalCpuCount}).catch(error => {
	logger.error(error);
});
