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

const isTlsSocket = (socket: unknown): socket is TLSSocket => Boolean((socket as { getPeerCertificate?: unknown }).getPeerCertificate);

export class HttpCommand implements CommandInterface<HttpOptions> {
	async run (measurementId: string, testId: string, options: HttpOptions): Promise<unknown> {
		const validationResult = httpOptionsSchema.validate(options);

		if (validationResult.error) {
			throw new InvalidOptionsException('http', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBuffer(testId, measurementId, 'append');
		const result = getInitialResult();

		const respond = (resolvePromise: (out: unknown) => void) => {
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

			const out = this.toJsonOutput({
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
			});

			buffer.pushResult(out);
			resolvePromise(out);
		};
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
}
