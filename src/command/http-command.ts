import type { TLSSocket } from 'node:tls';
import type { Socket as NetSocket } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import http2 from 'http2-wrapper';
import Joi from 'joi';
import _ from 'lodash';
import got, { type Response, type Request, type HTTPAlias, type DnsLookupIpVersion, type RequestError, HTTPError } from 'got';
import type { Socket } from 'socket.io-client';
import type { CommandInterface } from '../types.js';
import { callbackify } from '../lib/util.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import { dnsLookup, type ResolverType } from './handlers/http/dns-resolver.js';

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
	subjectaltname?: string;
};

type Output = {
	status: 'finished' | 'failed';
	resolvedAddress: string;
	headers: Record<string, string>;
	rawHeaders: string;
	rawBody: string;
	statusCode: number;
	statusCodeName: string;
	timings: Record<string, number>;
	tls: Cert | Record<string, unknown>;
	rawOutput: string;
};

/* eslint-disable @typescript-eslint/ban-types */
export type OutputJson = {
	status: 'finished' | 'failed';
	resolvedAddress: string | null;
	headers: Record<string, string>;
	rawHeaders: string | null;
	rawBody: string | null;
	statusCode: number | null;
	statusCodeName: string | null;
	timings: Record<string, number | null>;
	tls: Cert | null;
	rawOutput: string | null;
};
/* eslint-enable @typescript-eslint/ban-types */

export type Timings = {
	[k: string]: number | Record<string, unknown> | undefined;
	phases: Record<string, number | undefined>;
};

const getInitialResult = () => ({
	status: 'finished' as 'finished' | 'failed',
	resolvedAddress: '',
	tls: {},
	error: '',
	headers: {},
	rawHeaders: '',
	rawBody: '',
	statusCode: 0,
	statusCodeName: '',
	httpVersion: '',
	timings: {},
});

const allowedHttpProtocols = [ 'HTTP', 'HTTPS', 'HTTP2' ];
const allowedHttpMethods = [ 'GET', 'HEAD' ];

export const httpOptionsSchema = Joi.object<HttpOptions>({
	type: Joi.string().valid('http').insensitive().required(),
	inProgressUpdates: Joi.boolean().required(),
	target: Joi.alternatives().try(Joi.string().ip(), Joi.string().domain()).required(),
	resolver: Joi.string().ip(),
	protocol: Joi.string().valid(...allowedHttpProtocols).insensitive().default('HTTPS'),
	port: Joi.number(),
	request: Joi.object({
		method: Joi.string().valid(...allowedHttpMethods).insensitive().default('HEAD'),
		host: Joi.string().domain(),
		path: Joi.string().optional().default('/'),
		query: Joi.string().allow('').optional().default(''),
		headers: Joi.object().default({}),
	}).required(),
});

export const urlBuilder = (options: HttpOptions): string => {
	const protocolPrefix = options.protocol === 'HTTP' ? 'http' : 'https';
	const port = options.port ? options.port : (options.protocol === 'HTTP' ? 80 : 443);
	const path = `/${options.request.path}`.replace(/^\/\//, '/');
	const query = options.request.query.length > 0 ? `?${options.request.query}`.replace(/^\?\?/, '?') : '';
	const url = `${protocolPrefix}://${options.target}:${port}${path}${query}`;

	return url;
};

export const httpCmd = (options: HttpOptions, resolverFn?: ResolverType): Request => {
	const url = urlBuilder(options);
	const dnsResolver = callbackify(dnsLookup(options.resolver, resolverFn), true);

	const options_ = {
		method: options.request.method as HTTPAlias,
		followRedirect: false,
		cache: false,
		dnsLookup: dnsResolver,
		dnsLookupIpVersion: 4 as DnsLookupIpVersion,
		http2: options.protocol === 'HTTP2',
		timeout: {
			request: 10_000,
			response: 10_000,
		},
		https: { rejectUnauthorized: false },
		headers: {
			...options.request.headers,
			'User-Agent': 'globalping probe (https://github.com/jsdelivr/globalping)',
			'host': options.request.host ?? options.target,
		},
		setHost: false,
		throwHttpErrors: false,
		context: {
			downloadLimit: 10_000,
		},
		agent: {
			// Ensure Connection: closed header is used - https://nodejs.org/api/http.html#new-agentoptions
			http: new http.Agent({ keepAlive: false, maxSockets: Infinity }),
			https: new https.Agent({ maxCachedSessions: 0, keepAlive: false, maxSockets: Infinity }),
			http2: new http2.Agent({ maxCachedTlsSessions: 1 }),
		},
	};

	return got.stream(url, options_);
};

const isTlsSocket = (socket: unknown): socket is TLSSocket => Boolean((socket as {getPeerCertificate?: unknown}).getPeerCertificate);

export class HttpCommand implements CommandInterface<HttpOptions> {
	constructor (private readonly cmd: typeof httpCmd) {}

	async run (socket: Socket, measurementId: string, testId: string, options: HttpOptions): Promise<void> {
		const { value: cmdOptions, error: validationError } = httpOptionsSchema.validate(options);

		if (validationError) {
			throw new InvalidOptionsException('http', validationError);
		}

		const buffer = new ProgressBuffer(socket, testId, measurementId);
		const stream = this.cmd(cmdOptions);

		let result = getInitialResult();
		let cert: Cert | undefined;

		const respond = (resolveStream: () => void) => {
			result.resolvedAddress = stream.ip ?? '';

			const { total, download } = this.parseStreamTimings(stream);
			result.timings = { ...result.timings, total, download };

			let rawOutput;

			if (result.status === 'failed') {
				rawOutput = result.error;
			} else if (result.error) {
				rawOutput = `HTTP/${result.httpVersion} ${result.statusCode}\n${result.rawHeaders}\n\n${result.error}`;
			} else if (cmdOptions.request.method === 'HEAD') {
				rawOutput = `HTTP/${result.httpVersion} ${result.statusCode}\n${result.rawHeaders}`;
			} else {
				rawOutput = `HTTP/${result.httpVersion} ${result.statusCode}\n${result.rawHeaders}\n\n${result.rawBody}`;
			}

			buffer.pushResult(this.toJsonOutput({
				status: result.status,
				resolvedAddress: result.resolvedAddress,
				headers: result.headers,
				rawHeaders: result.rawHeaders,
				rawBody: result.rawBody,
				rawOutput,
				statusCode: result.statusCode,
				statusCodeName: result.statusCodeName,
				timings: result.timings,
				tls: result.tls,
			}));

			resolveStream();
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
			const isFirstMessage = result.rawBody.length === 0;
			const downloadLimit = stream.options.context['downloadLimit'] as number || Infinity;
			let dataString = data.toString();

			const remainingSize = downloadLimit - result.rawBody.length;

			if (dataString.length > remainingSize) {
				dataString = dataString.substring(0, remainingSize);
				stream.destroy(new Error('Exceeded the download.'));
			}

			result.rawBody += dataString;

			if (cmdOptions.inProgressUpdates) {
				let rawOutput = '';

				if (isFirstMessage) {
					rawOutput += `HTTP/${result.httpVersion} ${result.statusCode}\n${result.rawHeaders}\n\n`;
				}

				rawOutput += dataString;

				buffer.pushProgress({
					...(isFirstMessage && { rawHeaders: result.rawHeaders }),
					rawBody: dataString,
					rawOutput,
				});
			}
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

		const pStream = new Promise((_resolve) => {
			const resolve = () => {
				_resolve(null);
			};

			stream.on('data', onData);
			stream.on('response', onResponse);
			stream.on('socket', onSocket);

			stream.on('error', (error: RequestError) => {
				if (error instanceof HTTPError || error.message === 'Exceeded the download.') {
					result.status = 'finished';
				} else {
					result.status = 'failed';
				}

				// Skip error mapping on download limit
				if (error.message !== 'Exceeded the download.') {
					result.error = `${error.message} - ${error.code}`;
				}

				respond(resolve);
			});

			stream.on('end', () => {
				respond(resolve);
			});
		});

		await pStream;
	}

	private toJsonOutput (input: Output): OutputJson {
		return {
			status: input.status,
			resolvedAddress: input.resolvedAddress || null,
			headers: input.headers,
			rawHeaders: input.rawHeaders || null,
			rawBody: input.rawBody || null,
			rawOutput: input.rawOutput,
			statusCode: input.statusCode || null,
			statusCodeName: input.statusCodeName || null,
			timings: {
				total: 0,
				download: 0,
				firstByte: null,
				dns: null,
				tls: null,
				tcp: null,
				...input.timings,
			},
			tls: Object.keys(input.tls).length > 0 ? input.tls as Cert : null,
		};
	}

	private parseStreamTimings (stream: Request) {
		const timings = { ...stream.timings };
		timings.end = timings.end ?? Date.now();
		timings.phases = timings.phases ?? {};

		let total = null;

		if (timings.phases.total !== undefined) {
			total = timings.phases.total;
		} else if (timings.end !== undefined && timings.start !== undefined) {
			total = Number(timings.end) - Number(timings.start);
		}

		let download = null;

		if (timings.phases.download !== undefined) {
			download = timings.phases.download;
		} else if (timings.end !== undefined && timings.response !== undefined) {
			download = Number(timings.end) - Number(timings.response);
		}

		return { total, download };
	}

	private parseResponse (resp: Response, cert: Cert | undefined) {
		const result = getInitialResult();

		// Headers
		result.rawHeaders = _.chunk(resp.rawHeaders, 2)
			.map((g: string[]) => `${String(g[0])}: ${String(g[1])}`)
			.filter((r: string) => !r.startsWith(':status:'))
			.join('\n');

		result.headers = resp.headers as Record<string, string>;

		result.statusCode = resp.statusCode;
		result.statusCodeName = resp.statusMessage ?? '';
		result.httpVersion = resp.httpVersion;

		result.timings = {
			firstByte: resp.timings.phases.firstByte ?? null,
			dns: resp.timings.phases.dns ?? null,
			tls: resp.timings.phases.tls ?? null,
			tcp: resp.timings.phases.tcp ?? null,
		};

		if (cert) {
			result.tls = {
				authorized: cert.authorized,
				...(cert.authorizationError ? { error: cert.authorizationError } : {}),
				...(cert.valid_from && cert.valid_to ? {
					createdAt: (new Date(cert.valid_from)).toISOString(),
					expiresAt: (new Date(cert.valid_to)).toISOString(),
				} : {}),
				issuer: { ...cert.issuer },
				subject: {
					...cert.subject,
					alt: cert.subjectaltname,
				},
			};
		}

		return result;
	}
}
