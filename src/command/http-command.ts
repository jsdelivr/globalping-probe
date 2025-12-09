import type { Certificate } from 'node:tls';
import Joi from 'joi';
import type { CommandInterface } from '../types.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import { HttpTest } from './http-test.js';

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


export class HttpCommand implements CommandInterface<HttpOptions> {
	async run (measurementId: string, testId: string, cmdOptions: HttpOptions): Promise<unknown> {
		const validationResult = httpOptionsSchema.validate(cmdOptions);

		if (validationResult.error) {
			throw new InvalidOptionsException('http', validationResult.error);
		}

		const { value: options } = validationResult;
		const buffer = new ProgressBuffer(testId, measurementId, 'append');
		const test = new HttpTest(options, buffer);
		const out = await test.run();
		return out;
	}
}
