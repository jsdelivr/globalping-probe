import type { Certificate, TLSSocket } from 'node:tls';
import { isIP, isIPv6, type Socket as NetSocket } from 'node:net';
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
import { dnsLookup } from './handlers/shared/dns-resolver.js';

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

type Cert = {
	valid_to: string;
	valid_from: string;
	issuer: Certificate;
	subject: Certificate;
	subjectaltname?: string;
	pubkey?: Buffer;
	fingerprint: string;
	fingerprint256: string;
	fingerprint512: string;
	asn1Curve?: string;
	nistCurve?: string;
	modulus?: string;
	exponent?: string;
	serialNumber: string;
	bits?: number;
};

type TlsDetails = Cert & {
	protocol: string | null;
	authorized: boolean;
	authorizationError?: Error;
	cipherName: string;
};

type Output = {
	status: 'finished' | 'failed';
	resolvedAddress: string;
	headers: Record<string, string>;
	rawHeaders: string;
	rawBody: string;
	truncated: boolean;
	statusCode: number;
	statusCodeName: string;
	timings: Record<string, number>;
	tls: TlsDetails | Record<string, unknown>;
	rawOutput: string;
};

export type OutputJson = {
	status: 'finished' | 'failed';
	resolvedAddress: string | null;
	headers: Record<string, string>;
	rawHeaders: string | null;
	rawBody: string | null;
	truncated: boolean;
	statusCode: number | null;
	statusCodeName: string | null;
	timings: Record<string, number | null>;
	tls: TlsDetails | null;
	rawOutput: string | null;
};

export type Timings = {
	[k: string]: number | Record<string, unknown> | undefined | null;
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
	truncated: false,
	statusCode: 0,
	statusCodeName: '',
	httpVersion: '',
	timings: {},
});

const allowedHttpProtocols = [ 'HTTP', 'HTTPS', 'HTTP2' ];
const allowedHttpMethods = [ 'GET', 'HEAD', 'OPTIONS' ];
const allowedIpVersions = [ 4, 6 ];

export const httpOptionsSchema = Joi.object<HttpOptions>({
	type: Joi.string().valid('http').insensitive().required(),
	inProgressUpdates: Joi.boolean().required(),
	target: Joi.string(),
	resolver: Joi.string().ip(),
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

export const urlBuilder = (options: HttpOptions): string => {
	const protocolPrefix = options.protocol === 'HTTP' ? 'http' : 'https';
	const port = options.port ? options.port : (options.protocol === 'HTTP' ? 80 : 443);
	const path = `/${options.request.path}`.replace(/^\/\//, '/');
	const query = options.request.query.length > 0 ? `?${options.request.query}`.replace(/^\?\?/, '?') : '';
	const url = `${protocolPrefix}://${isIPv6(options.target) ? `[${options.target}]` : options.target}:${port}${path}${query}`;

	return url;
};

export const httpCmd = (options: HttpOptions): Request => {
	const url = urlBuilder(options);
	const dnsResolver = callbackify(dnsLookup(options.resolver), true);

	const options_ = {
		method: options.request.method as HTTPAlias,
		followRedirect: false,
		cache: false,
		dnsLookup: dnsResolver,
		dnsLookupIpVersion: (options.ipVersion ?? 4) as DnsLookupIpVersion,
		http2: options.protocol === 'HTTP2',
		timeout: {
			request: 10_000,
		},
		https: { rejectUnauthorized: false },
		headers: {
			...options.request.headers,
			'User-Agent': 'globalping probe (https://github.com/jsdelivr/globalping)',
			'host': options.request.host ?? options.target,
		},
		...(options.request.method === 'OPTIONS' && { body: '' }), // https://github.com/sindresorhus/got/issues/2394
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

const isTlsSocket = (socket: unknown): socket is TLSSocket => Boolean((socket as { getPeerCertificate?: unknown }).getPeerCertificate);

export class HttpCommand implements CommandInterface<HttpOptions> {
	constructor (private readonly cmd: typeof httpCmd) {}

	async run (socket: Socket, measurementId: string, testId: string, options: HttpOptions): Promise<void> {
		const validationResult = httpOptionsSchema.validate(options);

		if (validationResult.error) {
			throw new InvalidOptionsException('http', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'append');
		const stream = this.cmd(cmdOptions);

		let result = getInitialResult();
		let tlsDetails: TlsDetails | undefined;

		const respond = (resolveStream: () => void) => {
			result.resolvedAddress = stream.ip ?? '';

			if (result.status === 'finished') {
				const { total, download } = this.parseStreamTimings(stream);
				const timings = { ...result.timings, total, download };
				validateTimings(timings);
				result.timings = timings;
			}

			let rawOutput;

			if (result.status === 'failed') {
				rawOutput = result.error;
			} else if (result.error) {
				rawOutput = `HTTP/${result.httpVersion} ${result.statusCode}\n${result.rawHeaders}\n\n${result.error}`;
			} else if (cmdOptions.request.method === 'HEAD' || !result.rawBody) {
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
				truncated: result.truncated,
				statusCode: result.statusCode,
				statusCodeName: result.statusCodeName,
				timings: result.timings,
				tls: result.tls,
			}));

			resolveStream();
		};

		const captureTlsDetails = (socket: TLSSocket): TlsDetails | undefined => {
			return {
				...socket.getPeerCertificate(),
				protocol: socket.getProtocol(),
				cipherName: socket.getCipher().name,
				authorized: socket.authorized,
				authorizationError: socket.authorizationError,
			};
		};

		// HTTPS cert is not guaranteed to be available after this point
		const onSocket = (socket: NetSocket | TLSSocket) => {
			if (isTlsSocket(socket)) {
				socket.on('secureConnect', () => {
					tlsDetails = captureTlsDetails(socket);
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
				result.truncated = true;
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

		const onResponse = (resp: Response, cmdOptions: HttpOptions) => {
			// HTTP2 cert only available in the final response
			if (!tlsDetails && isTlsSocket(resp.socket)) {
				tlsDetails = captureTlsDetails(resp.socket);
			}

			result = {
				...result,
				...this.parseResponse(resp, tlsDetails, cmdOptions),
			};
		};

		const validateTimings = (timings: Record<string, unknown>) => {
			if (Object.values(timings).some(value => value && typeof value === 'number' && value < 0)) {
				result.status = 'failed';
				result.error = `Negative timing value reported: ${JSON.stringify({ resultTimings: result.timings, streamTimings: stream.timings, timings })}`;
			}
		};

		const pStream = new Promise((_resolve) => {
			const resolve = () => {
				_resolve(null);
			};

			stream.on('data', onData);
			stream.on('response', (resp: Response) => onResponse(resp, cmdOptions));
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
			truncated: input.truncated,
			statusCode: input.statusCode || null,
			statusCodeName: input.statusCodeName ?? null,
			timings: {
				total: null,
				download: null,
				firstByte: null,
				dns: null,
				tls: null,
				tcp: null,
				...input.timings,
			},
			tls: Object.keys(input.tls).length > 0 ? input.tls as TlsDetails : null,
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

	private parseResponse (resp: Response, tlsDetails: TlsDetails | undefined, cmdOptions: HttpOptions) {
		const result = getInitialResult();

		result.rawHeaders = _.chunk(resp.rawHeaders, 2)
			.map(([ key, value ]) => `${String(key)}: ${String(value)}`)
			.filter((rawHeader: string) => !rawHeader.startsWith(':'))
			.join('\n');

		result.headers = Object.fromEntries(Object.entries(resp.headers).filter(([ key ]) => !key.startsWith(':')));

		result.statusCode = resp.statusCode;
		result.statusCodeName = resp.statusMessage ?? '';
		result.httpVersion = resp.httpVersion;

		const timings = {
			firstByte: resp.timings.phases.firstByte ?? null,
			dns: resp.timings.phases.dns ?? null,
			tls: resp.timings.phases.tls ?? null,
			tcp: resp.timings.phases.tcp ?? null,
		};

		// Fixes https://github.com/szmarczak/http-timer/issues/35
		if (isIP(cmdOptions.target) && timings.dns !== null) {
			timings.tcp = (timings.tcp ?? 0) + timings.dns;
			timings.dns = 0;
		}

		result.timings = timings;

		if (tlsDetails) {
			result.tls = {
				authorized: tlsDetails.authorized,
				protocol: tlsDetails.protocol,
				cipherName: tlsDetails.cipherName,
				...(tlsDetails.authorizationError ? { error: tlsDetails.authorizationError } : {}),
				createdAt: tlsDetails.valid_from ? (new Date(tlsDetails.valid_from)).toISOString() : null,
				expiresAt: tlsDetails.valid_from ? (new Date(tlsDetails.valid_to)).toISOString() : null,
				issuer: {
					...(tlsDetails.issuer.C ? { C: tlsDetails.issuer.C } : {}),
					...(tlsDetails.issuer.O ? { O: tlsDetails.issuer.O } : {}),
					...(tlsDetails.issuer.CN ? { CN: tlsDetails.issuer.CN } : {}),
				},
				subject: {
					...(tlsDetails.subject.CN ? { CN: tlsDetails.subject.CN } : {}),
					...(tlsDetails.subjectaltname ? { alt: tlsDetails.subjectaltname } : {}),
				},
				keyType: tlsDetails.asn1Curve || tlsDetails.nistCurve ? 'EC' : tlsDetails.modulus || tlsDetails.exponent ? 'RSA' : null,
				keyBits: tlsDetails.bits || null,
				serialNumber: tlsDetails.serialNumber.match(/.{2}/g)!.join(':'),
				fingerprint256: tlsDetails.fingerprint256,
				publicKey: tlsDetails.pubkey ? tlsDetails.pubkey.toString('hex').toUpperCase().match(/.{2}/g)!.join(':') : null,
			};
		}

		return result;
	}
}
