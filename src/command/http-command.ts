import type {TLSSocket} from 'node:tls';
import Joi from 'joi';
import _ from 'lodash';
import got, {Response, Request, HTTPAlias, Progress, DnsLookupIpVersion} from 'got';
import type {Socket} from 'socket.io-client';
import type {CommandInterface} from '../types.js';
import {callbackify} from '../lib/util.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';
import {dnsLookup, ResolverType} from './handlers/http/dns-resolver.js';

export type HttpOptions = {
	type: string;
	target: string;
	query: {
		resolver?: string;
		method: string;
		host?: string;
		protocol: string;
		path: string;
		port?: number;
		headers?: Record<string, string>;
	};
};

export type Timings = {
	[k: string]: number | Record<string, unknown>;
	phases: Record<string, number>;
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
	}).required(),
});

export const httpCmd = (options: HttpOptions, resolverFn?: ResolverType): Request => {
	const protocolPrefix = options.query.protocol === 'http' ? 'http' : 'https';
	const port = options.query.port ?? options.query.protocol === 'http' ? 80 : 443;
	const path = options.query.path.startsWith('/') ? options.query.path : `/${options.query.path}`;
	const url = `${protocolPrefix}://${options.target}:${port}${path}`;
	const dnsResolver = callbackify(dnsLookup(options.query.resolver, resolverFn), true);

	const options_ = {
		method: options.query.method as HTTPAlias,
		followRedirect: false,
		cache: false,
		dnsLookup: dnsResolver,
		dnsLookupIpVersion: 4 as DnsLookupIpVersion,
		http2: options.query.protocol === 'http2',
		timeout: {response: 10_000},
		https: {rejectUnauthorized: false},
		headers: {
			...options.query.headers,
			'User-Agent': 'globalping probe (https://github.com/jsdelivr/globalping)',
			host: options.query.host ?? options.target,
		},
		setHost: false,
		throwHttpErrors: false,
		context: {
			downloadLimit: 10_000,
		},
	};

	return got.stream(url, options_);
};

const isTlsSocket = (socket: unknown): socket is TLSSocket => Boolean((socket as {getPeerCertificate?: unknown}).getPeerCertificate);

export class HttpCommand implements CommandInterface<HttpOptions> {
	constructor(private readonly cmd: typeof httpCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: HttpOptions): Promise<void> {
		const {value: cmdOptions, error} = httpOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('http', error);
		}

		const stream = this.cmd(cmdOptions);

		const result = {
			tls: {},
			error: '',
			headers: {},
			rawHeaders: '',
			curlHeaders: '',
			rawBody: '',
			statusCode: 0,
			httpVersion: '',
			timings: {},
		};

		const respond = () => {
			const timings = (stream.timings ?? {}) as Timings;
			if (!timings['end']) {
				timings['end'] = Date.now();
			}

			result.timings = {
				...result.timings,
				total: timings.phases['total'] ?? Number(timings['end']) - Number(timings['start']),
				download: timings.phases['download'] ?? Number(timings['end']) - Number(timings['response']),
			};

			const rawOutput = options.query.method === 'head'
				? `HTTP/${result.httpVersion} ${result.statusCode}\n` + result.curlHeaders
				: result.rawBody;

			socket.emit('probe:measurement:result', {
				testId,
				measurementId,
				result: {
					headers: result.headers,
					rawHeaders: result.rawHeaders,
					rawBody: result.rawBody,
					statusCode: result.statusCode,
					timings: result.timings,
					tls: result.tls,
					rawOutput: result.error || rawOutput,
				},
			});
		};

		stream.on('downloadProgress', (progress: Progress) => {
			const {downloadLimit} = stream.options.context;

			if (!downloadLimit) {
				return;
			}

			if (progress.transferred > Number(downloadLimit) && progress.percent !== 1) {
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
			// Headers
			const rawHeaders = _.chunk(resp.rawHeaders, 2).map((g: string[]) => `${String(g[0])}: ${String(g[1])}`);
			result.rawHeaders = rawHeaders.join('\n');
			result.curlHeaders = rawHeaders.filter((r: string) => !r.startsWith(':status:')).join('\n');
			result.headers = resp.headers;

			result.statusCode = resp.statusCode;
			result.httpVersion = resp.httpVersion;

			result.timings = {
				firstByte: resp.timings.phases.firstByte,
				dns: resp.timings.phases.dns,
				tls: resp.timings.phases.tls,
				tcp: resp.timings.phases.tcp,
			};

			const rSocket = resp.socket;
			if (isTlsSocket(rSocket)) {
				const cert = rSocket.getPeerCertificate();
				result.tls = {
					authorized: rSocket.authorized,
					...(rSocket.authorizationError ? {error: rSocket.authorizationError} : {}),
					createdAt: cert.valid_from,
					expireAt: cert.valid_to,
					issuer: {...cert.issuer},
					subject: {
						...cert.subject,
						alt: cert.subjectaltname,
					},
				};
			}
		});

		stream.on('error', (error: Error & {code: string}) => {
			// Skip error mapping on download limit
			if (error.message !== 'Exceeded the download.') {
				result.error = `${error.message} - ${error.code}`;
			}

			respond();
		});

		stream.on('end', () => {
			respond();
		});

		// eslint-disable-next-line unicorn/no-useless-promise-resolve-reject
		return Promise.resolve();
	}
}
