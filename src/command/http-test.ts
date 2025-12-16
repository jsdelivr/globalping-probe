import { isIP, isIPv6 } from 'node:net';
import type { TLSSocket } from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import zlib from 'node:zlib';
import type { Dispatcher } from 'undici';
import { Client, buildConnector } from 'undici';
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

type ConnectorState = {
	dns: number | null;
	tcp: number | null;
	tls: number | null;
	resolvedAddress: string | null;
	tlsInfo: Record<string, unknown> | null;
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

function wrapConnector (
	baseConnector: buildConnector.connector,
	startTime: number,
	state: ConnectorState,
	isHttps: boolean,
): buildConnector.connector {
	return (opts, callback) => {
		const socket = baseConnector(opts, callback);

		socket.once('lookup', (_err, address) => {
			state.dns = Date.now() - startTime;
			state.resolvedAddress = address;
		});

		socket.once('connect', () => {
			state.tcp = Date.now() - startTime - (state.dns ?? 0);

			if (!isHttps) {
				state.tls = null;
				state.httpVersion = '1.1';
			}
		});

		if (isHttps) {
			socket.once('secureConnect', () => {
				state.tls = Date.now() - startTime - (state.dns ?? 0) - (state.tcp ?? 0);
				const tlsSocket = socket as TLSSocket;
				const cert = tlsSocket.getPeerCertificate();
				state.httpVersion = tlsSocket.alpnProtocol === 'h2' ? '2.0' : tlsSocket.alpnProtocol === 'h3' ? '3' : '1.1';

				state.tlsInfo = {
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
			});
		}

		return socket;
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
	private connectorState: ConnectorState | null = null;
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

		this.timings.start = Date.now();
		this.connectorState = { dns: null, tcp: null, tls: null, resolvedAddress: null, tlsInfo: null, httpVersion: null };

		const dnsResolver = callbackify(dnsLookup(this.options.resolver), true);
		const baseConnector = buildConnector({
			lookup: dnsResolver,
			rejectUnauthorized: false,
			family: this.options.ipVersion,
			autoSelectFamily: false,
		});

		const connector = wrapConnector(baseConnector, this.timings.start, this.connectorState, this.isHttps);
		this.undiciClient = new Client(this.url.origin, { connect: connector });
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
				if (this.connectorState) {
					this.timings.dns = this.connectorState.dns;
					this.timings.tcp = this.connectorState.tcp;
					this.timings.tls = this.connectorState.tls;
					this.result.resolvedAddress = this.connectorState.resolvedAddress;
					this.httpVersion = this.connectorState.httpVersion;

					if (this.connectorState.tlsInfo) {
						this.result.tls = this.connectorState.tlsInfo;
					}
				}
			},
			onError: (err: Error) => this.handleError(err.message),
			onHeaders: (statusCode, headers, _resume, statusText) => {
				this.timings.firstByte = Date.now() - this.timings.start! - (this.timings.dns ?? 0) - (this.timings.tcp ?? 0) - (this.timings.tls ?? 0);
				this.result.statusCode = statusCode;
				this.result.statusCodeName = statusText;

				const rawHeaderPairs = [];

				if (headers) {
					for (let i = 0; i < headers.length; i += 2) {
						const key = headers[i]!.toString();
						const value = headers[i + 1]!.toString();
						this.result.headers[key.toLowerCase()] = value;
						rawHeaderPairs.push(`${key}: ${value}`);
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

				this.onHttpComplete();
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

		this.decompressor.on('data', (chunk: Buffer) => {
			if (!this.onHttpData(chunk)) {
				this.decompressor?.destroy();
			}
		});

		this.decompressor.on('end', () => this.onHttpComplete());
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
			this.onHttpComplete();
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

	private onHttpComplete = () => {
		if (this.timings.total !== null) {
			return;
		}

		this.timeoutTimer && clearTimeout(this.timeoutTimer);
		const now = Date.now();
		this.timings.download = now - this.timings.start! - (this.timings.dns ?? 0) - (this.timings.tcp ?? 0) - (this.timings.tls ?? 0) - this.timings.firstByte!;
		this.timings.total = now - this.timings.start!;
		this.cleanup();
		this.sendResult();
	};

	private getInitialResult () {
		return {
			status: 'finished' as 'finished' | 'failed',
			resolvedAddress: isIP(this.options.target) ? this.options.target : null,
			headers: {} as Record<string, string>,
			rawHeaders: '',
			rawBody: '',
			rawOutput: '',
			truncated: false,
			statusCode: 0,
			statusCodeName: '',
			tls: {},
			error: '',
		};
	}

	private cleanup () {
		this.connectorState = null;
		this.decompressor?.removeAllListeners();
		this.decompressor?.destroy();
		this.decompressor = null;
		this.undiciClient.destroy().catch(() => {});
	}

	private handleError = (message: string) => {
		if (this.timings.total !== null) {
			return;
		}

		this.timeoutTimer && clearTimeout(this.timeoutTimer);
		this.result.status = 'failed';
		this.result.error = message;
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
		} else if (this.result.error) {
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
