import * as process from 'node:process';
import throng from 'throng';
import {io} from 'socket.io-client';
import cryptoRandomString from 'crypto-random-string';
import physicalCpuCount from 'physical-cpu-count';
import type {CommandInterface, MeasurementRequest, WsApiError, ProbeLocation} from './types.js';
import {scopedLogger} from './lib/logger.js';
import {pingCmd, PingCommand} from './command/ping-command.js';
import {traceCmd, TracerouteCommand} from './command/traceroute-command.js';
import {dnsCmd, DnsCommand} from './command/dns-command.js';
import {getConfValue} from './lib/config.js';

const logger = scopedLogger('general');
const handlersMap = new Map<string, CommandInterface<any>>();

handlersMap.set('ping', new PingCommand(pingCmd));
handlersMap.set('traceroute', new TracerouteCommand(traceCmd));
handlersMap.set('dns', new DnsCommand(dnsCmd));

logger.info(`Start probe in a ${process.env['NODE_ENV'] ?? 'production'} mode`);

function connect() {
	const socket = io(`${getConfValue<string>('api.host')}/probes`, {
		transports: ['websocket'],
	});

	socket
		.on('connect', () => logger.debug('connection to API established'))
		.on('disconnect', () => logger.debug('disconnected from API'))
		.on('connect_error', error => logger.error('connection to API failed', error))
		.on('api:error', (error: WsApiError) => {
			logger.error('disconnected due to error:', error);
			if (error.info.probe) {
				const location = error.info.probe?.location;
				logger.info(`attempted to connect from (${location.city}, ${location.country}, ${location.continent}) (lat: ${location.latitude} long: ${location.longitude})`);
			}

			if (error.info.code === 'ip_limit' && error.info.cause) {
				const location = error.info.cause.probe?.location;

				logger.info(`other connection: (${location.city}, ${location.country}, ${location.continent}) (lat: ${location.latitude} long: ${location.longitude})`);
			}
		})
		.on('api:connect:location', (data: ProbeLocation) => {
			logger.info(`connected from (${data.city}, ${data.country}, ${data.continent}) (lat: ${data.latitude} long: ${data.longitude})`);
		})
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

if (process.env['NODE_ENV'] === 'development') {
	// Run multiple clients in dev mode for easier debugging
	throng({worker: connect, count: physicalCpuCount}).catch(error => {
		logger.error(error);
	});
} else {
	connect();
}
