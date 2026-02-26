import net, { isIP, isIPv6 } from 'node:net';
import type { LookupFunction } from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import type { Dispatcher } from 'undici';
import { Client } from 'undici';
import type { buildConnector } from 'undici';
import _ from 'lodash';
import { ProgressBuffer } from '../../../helper/progress-buffer.js';
import type { HttpOptions } from '../../http-command.js';
import { dnsLookup } from '../shared/dns-resolver.js';
import { callbackify } from '../../../lib/util.js';
import { isIpPrivate } from '../../../lib/private-ip.js';

type TlsDetails = {
	authorized: boolean;
	protocol: string | null;
	cipherName: string;
	createdAt: string | null;
	expiresAt: string | null;
	error?: Error;
	subject: {
		alt?: string;
		CN?: string;
	};
	issuer: {
		CN?: string;
		O?: string;
		C?: string;
	};
	keyType: string | null;
	keyBits: number | null;
	serialNumber: string | null;
	fingerprint256: string;
	publicKey: string | null;
};

type Timings = {
	start: number | null;
	total: number | null;
	dns: number | null;
	tcp: number | null;
	tls: number | null;
	firstByte: number | null;
	download: number | null;
};

type Result = {
	status: 'finished' | 'failed';
	resolvedAddress: string | null;
	httpVersion: string | null;
	headers: Record<string, string | string[]>;
	rawHeaders: string;
	rawBody: string;
	truncated: boolean;
	statusCode: number | null;
	statusCodeName: string | null;
	tls: TlsDetails | null;
	rawOutput: string;
};

export type OutputJson = {
	status: 'finished' | 'failed';
	resolvedAddress: string | null;
	headers: Record<string, string | string[]>;
	rawHeaders: string | null;
	rawBody: string | null;
	truncated: boolean;
	statusCode: number | null;
	statusCodeName: string | null;
	timings: Omit<Timings, 'start'>;
	tls: TlsDetails | null;
	rawOutput: string | null;
};

type Decompressor = zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress;

const lowerCaseKeys = (obj: Record<string, string>) => _.mapKeys(obj, (_value, key) => _.toLower(key)) as Record<string, string>;

const decompressors = Object.assign(Object.create(null), {
	'gzip': zlib.createGunzip,
	'x-gzip': zlib.createGunzip,
	'br': zlib.createBrotliDecompress,
	'deflate': zlib.createInflate,
	'compress': zlib.createInflate,
	'x-compress': zlib.createInflate,
}) as Record<string, () => Decompressor>;

// This function shouldn't be part of the class to avoid memory leaks.
function getConnector (
	options: HttpOptions,
	port: number,
	isHttps: boolean,
	dnsResolver: LookupFunction,
	result: Omit<Result, 'timings'>,
	timings: Timings,
): buildConnector.connector {
	return (connectorOptions, callback) => {
		timings.start = Date.now();

		const tcpSocket = net.connect({
			host: connectorOptions.hostname,
			port: Number(connectorOptions.port) || port,
			autoSelectFamily: false,
			family: options.ipVersion,
			lookup: dnsResolver,
		});

		tcpSocket.on('lookup', (_err, address) => {
			if (isIpPrivate(address)) {
				tcpSocket.destroy();
				callback(new Error('Private IP ranges are not allowed.'), null);
				return;
			}

			timings.dns = Date.now() - timings.start!;
			result.resolvedAddress = address;
		});

		tcpSocket.on('error', (err) => {
			callback(err, null);
		});

		tcpSocket.on('connect', () => {
			if (
				!tcpSocket.remoteAddress
				|| tcpSocket.remoteAddress === tcpSocket.localAddress
				|| isIpPrivate(tcpSocket.remoteAddress)
			) {
				tcpSocket.destroy();
				callback(new Error('Private IP ranges are not allowed.'), null);
				return;
			}

			timings.tcp = Date.now() - timings.start! - (timings.dns ?? 0);

			if (!result.resolvedAddress && tcpSocket.remoteAddress) {
				result.resolvedAddress = tcpSocket.remoteAddress;
			}

			if (!isHttps) {
				result.httpVersion = '1.1';

				// This is required to detect HTTP/1.0.
				const onFirstData = (chunk: Buffer) => {
					const firstLine = chunk.toString('ascii', 0, 20);
					const match = /^HTTP\/(\d\.\d)/.exec(firstLine);

					if (match?.[1]) {
						result.httpVersion = match[1];
					}

					tcpSocket.removeListener('data', onFirstData);
				};

				tcpSocket.prependListener('data', onFirstData);
				callback(null, tcpSocket);
				return;
			}

			const tlsSocket = tls.connect({
				socket: tcpSocket,
				servername: options.request.host || (!isIP(connectorOptions.hostname) ? connectorOptions.hostname : undefined),
				rejectUnauthorized: false,
				ALPNProtocols: options.protocol === 'HTTP2' ? [ 'h2' ] : [ 'http/1.1' ],
			});

			tlsSocket.on('error', (err: Error) => {
				callback(err, null);
			});

			tlsSocket.on('secureConnect', () => {
				timings.tls = Date.now() - timings.start! - (timings.dns ?? 0) - (timings.tcp ?? 0);
				const cert = tlsSocket.getPeerCertificate();
				const alpn = tlsSocket.alpnProtocol;

				if (options.protocol === 'HTTP2' && alpn !== 'h2') {
					tlsSocket.destroy();
					callback(new Error('HTTP/2 is not supported by the server.'), null);
					return;
				}

				result.httpVersion = alpn === 'h2' ? '2.0' : alpn === 'h3' ? '3' : '1.1';

				result.tls = {
					authorized: tlsSocket.authorized,
					protocol: tlsSocket.getProtocol(),
					cipherName: tlsSocket.getCipher()?.name,
					...(tlsSocket.authorizationError ? { error: tlsSocket.authorizationError } : {}),
					createdAt: cert.valid_from ? (new Date(cert.valid_from)).toISOString() : null,
					expiresAt: cert.valid_to ? (new Date(cert.valid_to)).toISOString() : null,
					issuer: {
						...(cert.issuer?.C ? { C: cert.issuer.C } : {}),
						...(cert.issuer?.O ? { O: cert.issuer.O } : {}),
						...(cert.issuer?.CN ? { CN: cert.issuer.CN } : {}),
					},
					subject: {
						...(cert.subject?.CN ? { CN: cert.subject.CN } : {}),
						...(cert.subjectaltname ? { alt: cert.subjectaltname } : {}),
					},
					keyType: cert.asn1Curve || cert.nistCurve ? 'EC' : cert.modulus || cert.exponent ? 'RSA' : null,
					keyBits: cert.bits || null,
					serialNumber: cert.serialNumber?.match(/.{2}/g)?.join(':') ?? null,
					fingerprint256: cert.fingerprint256,
					publicKey: cert.pubkey?.toString('hex').toUpperCase().match(/.{2}/g)?.join(':') ?? null,
				};

				callback(null, tlsSocket);
			});
		});

		return tcpSocket;
	};
}

export class HttpHandler {
	private readonly REQUEST_TIMEOUT: number = 10_000;
	private readonly DOWNLOAD_LIMIT: number = 10_000;
	private readonly url: URL;
	private readonly port: number;
	private readonly isHttps: boolean;
	private undiciClient!: Client;
	private readonly result: Omit<Result, 'timings'>;
	private readonly timings: Timings = {
		start: null,
		total: null,
		dns: null,
		tcp: null,
		tls: null,
		firstByte: null,
		download: null,
	};

	private resolve!: (value: unknown) => void;
	private timeoutTimer: NodeJS.Timeout | null = null;
	private decompressor: Decompressor | null = null;
	private decompressorHasData = false;
	private done = false;

	constructor (
		private readonly options: HttpOptions,
		private readonly buffer: ProgressBuffer,
	) {
		this.result = this.getInitialResult();
		this.port = options.port ? options.port : (options.protocol === 'HTTP' ? 80 : 443);
		this.isHttps = options.protocol !== 'HTTP';
		this.url = new URL(this.urlBuilder());
	}

	public async run () {
		const promise = new Promise((resolve) => { this.resolve = resolve; });
		const dnsResolver = callbackify(dnsLookup(this.options.resolver), true);
		const allowH2 = this.options.protocol === 'HTTP2';
		const connector = getConnector(this.options, this.port, this.isHttps, dnsResolver, this.result, this.timings);
		this.undiciClient = new Client(this.url.origin, { connect: connector, allowH2 });
		this.timeoutTimer = setTimeout(() => this.handleError('Request timeout.'), this.REQUEST_TIMEOUT);

		this.undiciClient.dispatch({
			path: this.url.pathname + this.url.search,
			method: this.options.request.method as Dispatcher.HttpMethod,
			headers: lowerCaseKeys({
				'Accept-Encoding': `gzip, deflate, br`,
				...this.options.request.headers,
				'User-Agent': 'globalping probe (https://github.com/jsdelivr/globalping)',
				'Host': this.options.request.host ?? this.options.target,
				'Connection': 'close',
			}),
		}, {
			onConnect: () => {},
			onError: (err: Error) => this.handleError(err.message),
			onHeaders: (statusCode, headers, _resume, statusText) => {
				this.timings.firstByte = Date.now() - this.timings.start! - (this.timings.dns ?? 0) - (this.timings.tcp ?? 0) - (this.timings.tls ?? 0);
				this.result.statusCode = statusCode;
				this.result.statusCodeName = statusText;

				const rawHeaderPairs = [];

				if (headers) {
					const entries: [string, string][] = Array.isArray(headers)
						? _.chunk(headers as string[], 2).map(([ k, v ]) => [ String(k), String(v) ])
						: _.toPairs(headers).map(([ k, v ]) => [ k, String(v) ]);

					for (const [ key, value ] of entries) {
						const lowKey = key.toLowerCase();

						if (this.result.headers[lowKey] && Array.isArray(this.result.headers[lowKey])) {
							this.result.headers[lowKey].push(value);
						} else if (this.result.headers[lowKey]) {
							this.result.headers[lowKey] = [ this.result.headers[lowKey] as unknown as string, value ];
						} else {
							this.result.headers[lowKey] = value;
						}

						rawHeaderPairs.push(`${key}: ${value}`);
					}
				}

				this.result.rawHeaders = rawHeaderPairs.join('\n');
				this.setupDecompressor();
				return true;
			},
			onData: (chunk: Buffer) => {
				if (this.decompressor) {
					this.decompressorHasData = true;
					this.decompressor.write(chunk);
					return true;
				}

				return this.onHttpData(chunk);
			},
			onComplete: () => {
				if (this.decompressor && this.decompressorHasData) {
					this.decompressor.end();
					return;
				}

				this.handleSuccess();
			},
		});

		return promise;
	}

	public urlBuilder (): string {
		const options = this.options;
		const protocolPrefix = this.isHttps ? 'https' : 'http';
		const port = this.port;
		const path = `/${options.request.path}`.replace(/^\/\//, '/');
		const query = options.request.query.length > 0 ? `?${options.request.query}`.replace(/^\?\?/, '?') : '';
		const url = `${protocolPrefix}://${isIPv6(options.target) ? `[${options.target}]` : options.target}:${port}${path}${query}`;

		return url;
	}

	private setupDecompressor () {
		const encodingHeader = this.result.headers['content-encoding'];
		const encoding = typeof encodingHeader === 'string' ? encodingHeader?.toLowerCase() : null;

		if (!encoding) {
			return;
		}

		const decompressor = decompressors[encoding];

		if (!decompressor) {
			return;
		}

		this.decompressor = decompressor();
		this.decompressor.on('data', (chunk: Buffer) => this.onHttpData(chunk));
		this.decompressor.on('end', () => this.handleSuccess());
		this.decompressor.on('error', (err: Error) => this.handleError(err.message));
	}

	private onHttpData = (chunk: Buffer) => {
		const isFirstMessage = this.result.rawBody.length === 0;
		const remaining = this.DOWNLOAD_LIMIT - this.result.rawBody.length;
		let dataString = chunk.toString();

		if (dataString.length > remaining) {
			dataString = dataString.substring(0, remaining);
			this.result.rawBody += dataString;
			this.result.truncated = true;
			this.pushProgress(isFirstMessage, dataString);
			this.handleSuccess();
			return false;
		}

		this.result.rawBody += dataString;
		this.pushProgress(isFirstMessage, dataString);
		return true;
	};

	private pushProgress (isFirstMessage: boolean, dataString: string) {
		if (!this.options.inProgressUpdates) {
			return;
		}

		let rawOutput = '';

		if (isFirstMessage) {
			rawOutput += `HTTP/${this.result.httpVersion} ${this.result.statusCode}\n${this.result.rawHeaders}\n\n`;
		}

		rawOutput += dataString;

		this.buffer.pushProgress({
			...(isFirstMessage && { rawHeaders: this.result.rawHeaders }),
			rawBody: dataString,
			rawOutput,
		});
	}

	private getInitialResult () {
		return {
			status: 'finished' as 'finished' | 'failed',
			resolvedAddress: null,
			httpVersion: null,
			headers: {} as Record<string, string>,
			rawHeaders: '',
			rawBody: '',
			rawOutput: '',
			truncated: false,
			statusCode: null,
			statusCodeName: null,
			tls: null,
		};
	}

	private cleanup () {
		clearTimeout(this.timeoutTimer!);
		this.decompressor?.destroy();
		this.undiciClient.destroy().catch((error: Error) => console.error(error));
	}

	private handleSuccess = () => {
		if (this.done) {
			return;
		}

		this.done = true;
		const now = Date.now();
		this.timings.download = now - this.timings.start! - (this.timings.dns ?? 0) - (this.timings.tcp ?? 0) - (this.timings.tls ?? 0) - (this.timings.firstByte ?? 0);
		this.timings.total = now - this.timings.start!;

		if (this.options.request.method === 'HEAD' || !this.result.rawBody) {
			this.result.rawOutput = `HTTP/${this.result.httpVersion} ${this.result.statusCode}\n${this.result.rawHeaders}`;
		} else {
			this.result.rawOutput = `HTTP/${this.result.httpVersion} ${this.result.statusCode}\n${this.result.rawHeaders}\n\n${this.result.rawBody}`;
		}

		this.cleanup();
		this.sendResult();
	};

	private handleError = (message: string) => {
		if (this.done) {
			return;
		}

		this.done = true;
		Object.assign(this.result, this.getInitialResult());
		this.result.status = 'failed';
		this.result.rawOutput = message;

		for (const key of Object.keys(this.timings) as (keyof Timings)[]) {
			this.timings[key] = null;
		}

		this.cleanup();
		this.sendResult();
	};

	private sendResult = () => {
		const jsonOutput = this.getJsonOutput();

		this.buffer.pushResult(jsonOutput);
		this.resolve(jsonOutput);
	};

	private getJsonOutput (): OutputJson {
		return {
			status: this.result.status,
			resolvedAddress: this.result.resolvedAddress || null,
			headers: this.result.headers,
			rawHeaders: this.result.rawHeaders || null,
			rawBody: this.result.rawBody || null,
			rawOutput: this.result.rawOutput,
			truncated: this.result.truncated,
			statusCode: this.result.statusCode || null,
			statusCodeName: this.result.statusCodeName ?? null,
			timings: {
				total: this.timings.total,
				dns: this.timings.dns,
				tcp: this.timings.tcp,
				tls: this.timings.tls,
				firstByte: this.timings.firstByte,
				download: this.timings.download,
			},
			tls: this.result.tls,
		};
	}
}
