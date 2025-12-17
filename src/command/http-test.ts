import net, { isIP, isIPv6 } from 'node:net';
import type { LookupFunction } from 'node:net';
import tls from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import zlib from 'node:zlib';
import type { Dispatcher } from 'undici';
import { Client } from 'undici';
import type { buildConnector } from 'undici';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import type { HttpOptions, OutputJson } from './http-command.js';
import { dnsLookup } from './handlers/shared/dns-resolver.js';
import { callbackify } from '../lib/util.js';

type TlsDetails = {
	authorized: boolean;
	protocol: string | null;
	cipherName: string | undefined;
	error?: string;
	valid_from: string;
	valid_to: string;
	issuer: PeerCertificate['issuer'];
	subject: PeerCertificate['subject'];
};

type Output = {
	status: 'finished' | 'failed';
	resolvedAddress: string | null;
	headers: Record<string, string>;
	rawHeaders: string;
	rawBody: string;
	truncated: boolean;
	statusCode: number;
	statusCodeName: string;
	timings: Omit<Timings, 'start'>;
	tls: TlsDetails | Record<string, unknown>;
	rawOutput: string;
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

type Decompressor = zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress;

type HttpTestState = {
	timings: Timings;
	result: {
		resolvedAddress: string | null;
		tls: Record<string, unknown>;
	};
	httpVersion: string | null;
};

const createZstdDecompress = (zlib as { createZstdDecompress?: () => Decompressor }).createZstdDecompress;

const decompressors: Record<string, () => Decompressor> = {
	'gzip': zlib.createGunzip,
	'x-gzip': zlib.createGunzip,
	'br': zlib.createBrotliDecompress,
	'deflate': zlib.createInflate,
	'compress': zlib.createInflate,
	'x-compress': zlib.createInflate,
	...(createZstdDecompress ? { zstd: createZstdDecompress } : {}),
};

function getConnector (options: HttpOptions, port: number, isHttps: boolean, dnsResolver: LookupFunction, state: HttpTestState): buildConnector.connector {
	return (connOptions, callback) => {
		state.timings.start = Date.now();

		const tcpSocket = net.connect({
			host: connOptions.hostname,
			port: Number(connOptions.port) || port,
			autoSelectFamily: false,
			family: options.ipVersion,
			lookup: dnsResolver,
		});

		tcpSocket.on('lookup', (_err, address) => {
			state.timings.dns = Date.now() - state.timings.start!;
			state.result.resolvedAddress = address;
		});

		tcpSocket.on('error', (err) => {
			callback(err, null);
		});

		tcpSocket.on('connect', () => {
			state.timings.tcp = Date.now() - state.timings.start! - state.timings.dns!;

			if (!isHttps) {
				state.timings.tls = null;
				state.httpVersion = '1.1';
				callback(null, tcpSocket);
				return;
			}

			const tlsSocket = tls.connect({
				socket: tcpSocket,
				servername: !isIP(connOptions.hostname) ? connOptions.hostname : options.request.host,
				rejectUnauthorized: false,
				ALPNProtocols: options.protocol === 'HTTP2' ? [ 'h2' ] : [ 'http/1.1' ],
			});

			tlsSocket.on('error', (err: Error) => {
				callback(err, null);
			});

			tlsSocket.on('secureConnect', () => {
				state.timings.tls = Date.now() - state.timings.start! - state.timings.dns! - state.timings.tcp!;
				const cert = tlsSocket.getPeerCertificate();
				const alpn = tlsSocket.alpnProtocol;

				if (options.protocol === 'HTTP2' && alpn !== 'h2') {
					tlsSocket.destroy();
					callback(new Error('HTTP/2 not supported by the server.'), null);
					return;
				}

				state.httpVersion = alpn === 'h2' ? '2.0' : alpn === 'h3' ? '3' : '1.1';

				if (cert) {
					state.result.tls = {
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
						publicKey: cert.pubkey ? cert.pubkey.toString('hex').toUpperCase().match(/.{2}/g)!.join(':') : null,
					};
				}

				callback(null, tlsSocket);
			});
		});

		return tcpSocket;
	};
}

export class HttpTest {
	private readonly REQUEST_TIMEOUT: number = 10_000;
	private readonly DOWNLOAD_LIMIT: number = 10_000;
	private readonly result: ReturnType<typeof this.getInitialResult>;
	private readonly url: URL;
	private readonly port: number;
	private readonly isHttps: boolean;
	private resolve!: (value: unknown) => void;
	private undiciClient!: Client;
	private httpVersion: string | null = null;
	private timeoutTimer: NodeJS.Timeout | null = null;
	private decompressor: Decompressor | null = null;
	private done = false;
	private readonly timings: Timings = {
		start: null,
		total: null,
		dns: null,
		tcp: null,
		tls: null,
		firstByte: null,
		download: null,
	};

	constructor (
		private readonly options: HttpOptions,
		private readonly buffer: ProgressBuffer,
	) {
		this.result = this.getInitialResult();
		this.port = options.port ? options.port : (options.protocol === 'HTTP' ? 80 : 443);
		this.isHttps = options.protocol !== 'HTTP';
		this.url = this.urlBuilder();
	}

	public async run () {
		const promise = new Promise((resolve) => { this.resolve = resolve; });

		const dnsResolver = callbackify(dnsLookup(this.options.resolver), true);
		const allowH2 = this.options.protocol === 'HTTP2';

		const state: HttpTestState = {
			timings: this.timings,
			result: this.result,
			httpVersion: null,
		};

		const connector = getConnector(this.options, this.port, this.isHttps, dnsResolver, state);
		this.undiciClient = new Client(this.url.origin, { connect: connector, allowH2 });
		this.timeoutTimer = setTimeout(() => this.handleError('Request timeout.'), this.REQUEST_TIMEOUT);

		this.undiciClient.dispatch({
			path: this.url.pathname + this.url.search,
			method: this.options.request.method as Dispatcher.HttpMethod,
			headers: {
				'Accept-Encoding': `gzip, deflate, br${createZstdDecompress ? ', zstd' : ''}`,
				...this.options.request.headers,
				'User-Agent': 'globalping probe (https://github.com/jsdelivr/globalping)',
				'Host': this.options.request.host ?? this.options.target,
				'Connection': 'close',
			},
		}, {
			onConnect: () => {
				this.httpVersion = state.httpVersion;
			},
			onError: (err: Error) => this.handleError(err.message),
			onHeaders: (statusCode, headers, _resume, statusText) => {
				this.timings.firstByte = Date.now() - this.timings.start! - this.timings.dns! - this.timings.tcp! - this.timings.tls!;
				this.result.statusCode = statusCode;
				this.result.statusCodeName = statusText;

				const rawHeaderPairs = [];

				if (headers) {
					if (Array.isArray(headers)) {
						for (let i = 0; i < headers.length; i += 2) {
							const key = headers[i]!.toString();
							const value = headers[i + 1]!.toString();
							this.result.headers[key.toLowerCase()] = value;
							rawHeaderPairs.push(`${key}: ${value}`);
						}
					} else {
						for (const [ key, value ] of Object.entries(headers)) {
							const val = String(value);
							this.result.headers[key.toLowerCase()] = val;
							rawHeaderPairs.push(`${key}: ${val}`);
						}
					}
				}

				this.result.rawHeaders = rawHeaderPairs.join('\n');
				this.setupDecompressor();
				return true;
			},
			onData: (chunk: Buffer) => {
				if (this.decompressor) {
					this.decompressor.write(chunk);
					return true;
				}

				return this.onHttpData(chunk);
			},
			onComplete: () => {
				if (this.decompressor) {
					this.decompressor.end();
					return;
				}

				this.handleSuccess();
			},
		});

		return promise;
	}

	private urlBuilder (): URL {
		const options = this.options;
		const protocolPrefix = this.isHttps ? 'https' : 'http';
		const port = this.port;
		const path = `/${options.request.path}`.replace(/^\/\//, '/');
		const query = options.request.query.length > 0 ? `?${options.request.query}`.replace(/^\?\?/, '?') : '';
		const url = `${protocolPrefix}://${isIPv6(options.target) ? `[${options.target}]` : options.target}:${port}${path}${query}`;

		return new URL(url);
	}

	private setupDecompressor () {
		const encoding = this.result.headers['content-encoding']?.toLowerCase();

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
			rawOutput += `HTTP/${this.httpVersion} ${this.result.statusCode}\n${this.result.rawHeaders}\n\n`;
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
			resolvedAddress: isIP(this.options.target) ? this.options.target : null,
			headers: {} as Record<string, string>,
			rawHeaders: '',
			rawBody: '',
			rawOutput: '',
			truncated: false,
			statusCode: null,
			statusCodeName: '',
			tls: {},
			error: '',
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
		this.timings.download = now - this.timings.start! - this.timings.dns! - this.timings.tcp! - this.timings.tls! - this.timings.firstByte!;
		this.timings.total = now - this.timings.start!;
		this.cleanup();
		this.sendResult();
	};

	private handleError = (message: string) => {
		if (this.done) {
			return;
		}

		this.done = true;
		this.result.status = 'failed';
		this.result.resolvedAddress = null;
		this.result.error = message;
		this.result.headers = {};
		this.result.rawHeaders = null;
		this.result.rawBody = null;
		this.result.statusCode = null;
		this.result.statusCodeName = '';
		this.result.tls = {};

		this.timings.dns = null;
		this.timings.tcp = null;
		this.timings.tls = null;
		this.timings.firstByte = null;
		this.timings.download = null;
		this.timings.total = null;
		this.cleanup();
		this.sendResult();
	};

	private sendResult = () => {
		let rawOutput;

		if (this.result.status === 'failed') {
			rawOutput = this.result.error;
		} else if (this.result.error) { // TODO: this is never called
			rawOutput = `HTTP/${this.httpVersion} ${this.result.statusCode}\n${this.result.rawHeaders}\n\n${this.result.error}`;
		} else if (this.options.request.method === 'HEAD' || !this.result.rawBody) {
			rawOutput = `HTTP/${this.httpVersion} ${this.result.statusCode}\n${this.result.rawHeaders}`;
		} else {
			rawOutput = `HTTP/${this.httpVersion} ${this.result.statusCode}\n${this.result.rawHeaders}\n\n${this.result.rawBody}`;
		}

		const jsonOutput = this.toJsonOutput({
			status: this.result.status,
			resolvedAddress: this.result.resolvedAddress,
			headers: this.result.headers,
			rawHeaders: this.result.rawHeaders,
			rawBody: this.result.rawBody,
			rawOutput,
			truncated: this.result.truncated,
			statusCode: this.result.statusCode,
			statusCodeName: this.result.statusCodeName,
			timings: this.timings,
			tls: this.result.tls,
		});

		this.buffer.pushResult(jsonOutput);
		this.resolve(jsonOutput);
	};

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
				total: input.timings.total,
				dns: input.timings.dns,
				tcp: input.timings.tcp,
				tls: input.timings.tls,
				firstByte: input.timings.firstByte,
				download: input.timings.download,
			},
			tls: Object.keys(input.tls).length > 0 ? input.tls as OutputJson['tls'] : null,
		};
	}
}
