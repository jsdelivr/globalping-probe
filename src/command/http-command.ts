import type {TLSSocket} from 'node:tls';
import type {Socket as NetSocket} from 'node:net';
import http from 'node:http';
import https from 'node:https';
import http2 from 'http2-wrapper';
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

type Cert = {
	authorized: boolean;
	authorizationError?: Error;
	valid_to: string;
	valid_from: string;
	issuer: {
		C: string;
		O: string;
		CN: string;
	};
	subject: {
		CN: string;
	};
	subjectaltname: string;
};

export type Timings = {
	[k: string]: number | Record<string, unknown>;
	phases: Record<string, number>;
};

const getInitialResult = () => ({
	resolvedAddress: '',
	tls: {},
	error: '',
	headers: {},
	rawHeaders: '',
	curlHeaders: '',
	rawBody: '',
	statusCode: 0,
	httpVersion: '',
	timings: {},
});

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
		timeout: {
			request: 10_000,
			response: 10_000,
		},
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
		agent: {
			http: http.globalAgent,
			https: new https.Agent({maxCachedSessions: 0}),
			http2: new http2.Agent({maxCachedTlsSessions: 1}),
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

		let result = getInitialResult();
		let cert: Cert | undefined;

		const respond = (resolve: () => void) => {
			result.resolvedAddress = stream.ip ?? '';

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
					resolvedAddress: result.resolvedAddress,
					headers: result.headers,
					rawHeaders: result.rawHeaders,
					rawBody: result.rawBody,
					statusCode: result.statusCode,
					timings: result.timings,
					tls: result.tls,
					rawOutput: result.error || rawOutput,
				},
			});

			resolve();
		};

		const captureCert = (socket: TLSSocket): Cert | undefined => ({
			...socket.getPeerCertificate(),
			authorized: socket.authorized,
			authorizationError: socket.authorizationError,
		});

		// HTTPS cert is not guaranteed to be available after this point
		const onSocket = (socket: NetSocket | TLSSocket) => {
			if (isTlsSocket(socket)) {
				socket.on('secureConnect', () => {
					cert = captureCert(socket);
				});
			}
		};

		const onData = (data: Buffer) => {
			result.rawBody += data.toString();

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {rawOutput: data.toString()},
			});
		};

		const onResponse = (resp: Response) => {
			// HTTP2 cert only available in the final response
			if (!cert && isTlsSocket(resp.socket)) {
				cert = captureCert(resp.socket);
			}

			result = {
				...result,
				...this.parseResponse(resp, cert),
			};
		};

		const onDownloadProgress = (progress: Progress) => {
			const {downloadLimit} = stream.options.context;

			if (!downloadLimit) {
				return;
			}

			if (progress.transferred > Number(downloadLimit) && progress.percent !== 1) {
				stream.destroy(new Error('Exceeded the download.'));
			}
		};

		const pStream = new Promise((resolve, _reject) => {
			const onResolve = () => {
				resolve(null);
			};

			stream.on('downloadProgress', onDownloadProgress);
			stream.on('data', onData);
			stream.on('response', onResponse);
			stream.on('socket', onSocket);

			stream.on('error', (error: Error & {code: string}) => {
				// Skip error mapping on download limit
				if (error.message !== 'Exceeded the download.') {
					result.error = `${error.message} - ${error.code}`;
				}

				respond(onResolve);
			});

			stream.on('end', () => {
				respond(onResolve);
			});
		});

		await pStream;
	}

	private parseResponse(resp: Response, cert: Cert | undefined) {
		const result = getInitialResult();

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

		if (cert) {
			result.tls = {
				authorized: cert.authorized,
				...(cert.authorizationError ? {error: cert.authorizationError} : {}),
				...(cert.valid_from && cert.valid_to ? {
					createdAt: (new Date(cert.valid_from)).toISOString(),
					expiresAt: (new Date(cert.valid_to)).toISOString(),
				} : {}),
				issuer: {...cert.issuer},
				subject: {
					...cert.subject,
					alt: cert.subjectaltname,
				},
			};
		}

		return result;
	}
}
