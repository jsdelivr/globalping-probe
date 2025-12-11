import { isIP, isIPv6 } from 'node:net';
import tls, { type PeerCertificate } from 'node:tls';
import net from 'node:net';
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

export class HttpTest {
	private readonly DOWNLOAD_LIMIT: number = 10_000;
	private readonly result: ReturnType<typeof this.getInitialResult>;
	private readonly url: URL;
	private readonly port: number;
	private readonly isHttps: boolean;
	private resolve!: (value: unknown) => void;
	private reject!: (reason?: undefined) => void;
	private undiciClient!: Client;
	private httpVersion: string | null = null;
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
		const promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
		const connector = this.getConnector();
		this.undiciClient = new Client(this.url.origin, { connect: connector });

		this.undiciClient.dispatch({
			path: this.url.pathname + this.url.search,
			method: this.options.request.method,
			headers: {
				...this.options.request.headers,
				'User-Agent': 'globalping probe (https://github.com/jsdelivr/globalping)',
				'host': this.options.request.host ?? this.options.target,
				'Connection': 'close',
			},
		}, {
			onConnect () {},
			onError: (err) => {
				this.reject(err);
			},
			onResponseStarted: () => {
				this.timings.firstByte = Date.now() - this.timings.start! - this.timings.dns! - this.timings.tcp! - this.timings.tls!;
			},
			onHeaders: (statusCode, headers, _resume, statusText) => {
				this.result.statusCode = statusCode;
				this.result.statusCodeName = statusText;

				const rawHeaderPairs = [];

				for (let i = 0; i < headers.length; i += 2) {
					const key = headers[i]!.toString();
					const value = headers[i + 1]!.toString();
					this.result.headers[key.toLowerCase()] = value;
					rawHeaderPairs.push(`${key}: ${value}`);
				}

				this.result.rawHeaders = rawHeaderPairs.join('\n');
				return true;
			},
			onData: this.onHttpData,
			onComplete: this.onHttpComplete,
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

	private getConnector (): buildConnector.connector {
		return (connOptions, callback) => {
			const dnsResolver = callbackify(dnsLookup(this.options.resolver), true);
			this.timings.start = Date.now();
			const tcpSocket = net.connect({
				host: connOptions.hostname,
				port: Number(connOptions.port) || this.port,
				autoSelectFamily: false,
				family: this.options.ipVersion,
				lookup: dnsResolver,
			});

			tcpSocket.on('lookup', (_err, address) => {
				this.timings.dns = Date.now() - this.timings.start!;
				this.result.resolvedAddress = address;
			});

			tcpSocket.setTimeout(10_000);
			tcpSocket.on('timeout', () => tcpSocket.destroy(new Error('Connection timeout')));
			tcpSocket.on('error', err => callback(err, null));

			tcpSocket.on('connect', () => {
				this.timings.tcp = Date.now() - this.timings.start! - this.timings.dns!;

				if (!this.isHttps) {
					this.timings.tls = null;
					this.httpVersion = '1.1';
					callback(null, tcpSocket);
					return;
				}

				const tlsSocket = tls.connect({
					socket: tcpSocket,
					servername: connOptions.hostname,
					rejectUnauthorized: false,
					ALPNProtocols: this.options.protocol === 'HTTP2' ? [ 'h2' ] : [ 'http/1.1' ],
				});

				tlsSocket.on('error', (err: Error) => callback(err, null));

				tlsSocket.on('secureConnect', () => {
					this.timings.tls = Date.now() - this.timings.start! - this.timings.dns! - this.timings.tcp!;
					const cert = tlsSocket.getPeerCertificate();
					const alpn = tlsSocket.alpnProtocol;

					this.httpVersion = alpn === 'h2' ? '2' : alpn === 'h3' ? '3' : '1.1';

					this.result.tls = {
						authorized: tlsSocket.authorized,
						protocol: tlsSocket.getProtocol(),
						cipherName: tlsSocket.getCipher()?.name,
						...(tlsSocket.authorizationError ? { error: tlsSocket.authorizationError } : {}),
						createdAt: cert.valid_from ? (new Date(cert.valid_from)).toISOString() : null,
						expiresAt: cert.valid_to ? (new Date(cert.valid_to)).toISOString() : null,
						issuer: {
							...(cert.issuer.C ? { C: cert.issuer.C } : {}),
							...(cert.issuer.O ? { O: cert.issuer.O } : {}),
							...(cert.issuer.CN ? { CN: cert.issuer.CN } : {}),
						},
						subject: {
							...(cert.subject.CN ? { CN: cert.subject.CN } : {}),
							...(cert.subjectaltname ? { alt: cert.subjectaltname } : {}),
						},
						keyType: cert.asn1Curve || cert.nistCurve ? 'EC' : cert.modulus || cert.exponent ? 'RSA' : null,
						keyBits: cert.bits || null,
						serialNumber: cert.serialNumber.match(/.{2}/g)!.join(':'),
						fingerprint256: cert.fingerprint256,
						publicKey: cert.pubkey ? cert.pubkey.toString('hex').toUpperCase().match(/.{2}/g)!.join(':') : null,
					};

					callback(null, tlsSocket);
				});
			});
		};
	}

	private onHttpData = (chunk: Buffer) => {
		const remaining = this.DOWNLOAD_LIMIT - this.result.rawBody.length;

		if (chunk.length > remaining) {
			this.result.rawBody += chunk.slice(0, remaining).toString();
			this.result.truncated = true;
			this.onHttpComplete();
			return false;
		}

		this.result.rawBody += chunk.toString();
		return true;
	};


	private onHttpComplete = () => {
		const now = Date.now();
		this.timings.download = now - this.timings.start! - this.timings.dns! - this.timings.tcp! - this.timings.tls! - this.timings.firstByte!;
		this.timings.total = now - this.timings.start!;
		void this.undiciClient.close();
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
