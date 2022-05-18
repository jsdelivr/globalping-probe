import Joi from 'joi';
import _ from 'lodash';
import got, {Response, Request, HTTPAlias, Progress} from 'got';
import type {Socket} from 'socket.io-client';
import type {CommandInterface} from '../types.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

type HttpOptions = {
	type: 'http';
	target: string;
	query: {
		resolver: string;
		method: string;
		host: string;
		protocol: string;
		path: string;
		port: number;
		headers: Record<string, string>;
	};
};

const allowedHttpProtocols = ['http', 'https', 'http2'];
const allowedHttpMethods = ['get', 'head'];
export const httpOptionsSchema = Joi.object<HttpOptions>({
	type: Joi.string().valid('http').insensitive().required(),
	target: Joi.alternatives().try(Joi.string().ip(), Joi.string().domain()).required(),
	query: Joi.object({
		method: Joi.string().valid(...allowedHttpMethods).insensitive().default('head'),
		resolver: Joi.string().ip(),
		host: Joi.string().domain(),
		path: Joi.string().optional().default('/'),
		protocol: Joi.string().valid(...allowedHttpProtocols).insensitive().default('https'),
		port: Joi.number(),
		headers: Joi.object().default({}),
	}),
});

export const httpCmd = (options: HttpOptions): Request => {
	const protocolPrefix = options.query.protocol === 'http' ? 'http' : 'https';
	const port = options.query.port ?? options.query.protocol === 'http' ? 80 : 443;
	const url = `${protocolPrefix}://${options.target}:${port}${options.query.path}`;

	const options_ = {
		method: options.query.method as HTTPAlias,
		followRedirect: false,
		cache: false,
		http2: options.query.protocol === 'http2',
		timeout: {response: 10_000},
		https: {rejectUnauthorized: false},
		headers: {
			...options.query.headers,
			'User-Agent': 'globalping probe (https://github.com/jsdelivr/globalping)',
			host: options.query.host ?? options.target,
		},
		setHost: false,
		context: {
			downloadLimit: 10_000,
		},
	};

	return got.stream(url, options_);
};

export class HttpCommand implements CommandInterface<HttpOptions> {
	constructor(private readonly cmd: typeof httpCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: HttpOptions): Promise<void> {
		const {value: cmdOptions, error} = httpOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('http', error);
		}

		const stream = this.cmd(cmdOptions);

		const result = {
			headers: {},
			rawHeaders: '',
			rawBody: '',
			statusCode: 0,
		};

		stream.on('downloadProgress', (progress: Progress) => {
			if (progress.transferred > 10_000 && progress.percent !== 1) {
				stream.destroy(new Error('Exceeded the download.'));
			}
		});

		stream.on('data', (data: Buffer) => {
			result.rawBody += data.toString();

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {rawOutput: data.toString()},
			});
		});

		stream.on('response', (resp: Response) => {
			result.rawHeaders = _.chunk(resp.rawHeaders, 2).map((g: string[]) => `${g[0]!}: ${g[1]!}`).join('\n');
			result.headers = resp.headers;
			result.statusCode = resp.statusCode;
		});

		stream.on('end', () => {
			response();
		});

		const response = () => {
			const rawOutput = options.query.method === 'head'
				? `status ${result.statusCode}\n` + result.rawHeaders
				: result.rawBody;

			socket.emit('probe:measurement:result', {
				testId,
				measurementId,
				result: {
					...result,
					rawOutput,
				},
			});
		};
	}
}
