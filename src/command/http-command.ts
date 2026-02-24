import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import type { CommandInterface } from '../types.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { joiValidateIp } from '../lib/private-ip.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import { HttpHandler } from './handlers/http/undici.js';

export type HttpOptions = {
	type: 'http';
	inProgressUpdates: boolean;
	target: string;
	resolver?: string;
	protocol: string;
	port?: number;
	request: {
		method: string;
		host?: string;
		path: string;
		query: string;
		headers?: Record<string, string>;
	};
	ipVersion: number;
};

const allowedHttpProtocols = [ 'HTTP', 'HTTPS', 'HTTP2' ];
const allowedHttpMethods = [ 'GET', 'HEAD', 'OPTIONS' ];
const allowedIpVersions = [ 4, 6 ];

export const httpOptionsSchema = Joi.object<HttpOptions>({
	type: Joi.string().valid('http').insensitive().required(),
	inProgressUpdates: Joi.boolean().required(),
	target: Joi.string().custom(joiValidateIp).required(),
	resolver: Joi.string().ip().custom(joiValidateIp),
	protocol: Joi.string().valid(...allowedHttpProtocols).insensitive().default('HTTPS'),
	port: Joi.number(),
	request: Joi.object({
		method: Joi.string().valid(...allowedHttpMethods).insensitive().default('HEAD'),
		host: Joi.string(),
		path: Joi.string().optional().default('/'),
		query: Joi.string().allow('').optional().default(''),
		headers: Joi.object().default({}),
	}).required(),
	ipVersion: Joi.when(Joi.ref('target'), {
		is: Joi.string().ip({ version: [ 'ipv4' ], cidr: 'forbidden' }).required(),
		then: Joi.valid(4).default(4),
		otherwise: Joi.when(Joi.ref('target'), {
			is: Joi.string().ip({ version: [ 'ipv6' ], cidr: 'forbidden' }).required(),
			then: Joi.valid(6).default(6),
			otherwise: Joi.valid(...allowedIpVersions).default(4),
		}),
	}),
});

export class HttpCommand implements CommandInterface<HttpOptions> {
	async run (socket: Socket, measurementId: string, testId: string, cmdOptions: HttpOptions): Promise<unknown> {
		const validationResult = httpOptionsSchema.validate(cmdOptions);

		if (validationResult.error) {
			throw new InvalidOptionsException('http', validationResult.error);
		}

		const { value: options } = validationResult;
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'append');
		const handler = new HttpHandler(options, buffer);
		const out = await handler.run();
		return out;
	}
}
