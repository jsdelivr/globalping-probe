import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';

type DnsResponse = 'a' | 'aaaa' | 'txt' | 'nxdomain' | 'servfail' | 'silent';

const responses: Record<string, DnsResponse> = {
	'ipv4.compat.test': 'a',
	'ipv6.compat.test': 'aaaa',
	'txt.compat.test': 'txt',
	'trace.compat.test': 'a',
	'mtr.compat.test': 'a',
	'nxdomain.compat.test': 'nxdomain',
	'servfail.compat.test': 'servfail',
	'silent.compat.test': 'silent',
};

const maximumStartAttempts = 3;

const listen = (server: TcpServer, port: number, host: string): Promise<void> => new Promise((resolve, reject) => {
	server.once('error', reject);

	server.listen(port, host, () => {
		server.off('error', reject);
		resolve();
	});
});

const bind = (socket: UdpSocket, port: number, host: string): Promise<void> => new Promise((resolve, reject) => {
	socket.once('error', reject);

	socket.bind(port, host, () => {
		socket.off('error', reject);
		resolve();
	});
});

const closeTcp = (server: TcpServer): Promise<void> => new Promise((resolve, reject) => {
	server.close(error => error ? reject(error) : resolve());
});

const closeUdp = (socket: UdpSocket): Promise<void> => new Promise((resolve) => {
	socket.close(resolve);
});

const closeQuietly = async (close: () => Promise<void>): Promise<void> => {
	try {
		await close();
	} catch {}
};

const isAddressInUse = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'EADDRINUSE';

const readName = (packet: Buffer, offset: number): { name: string; end: number } => {
	const labels = [];

	while (packet[offset] !== 0) {
		const length = packet[offset]!;
		offset += 1;
		labels.push(packet.subarray(offset, offset + length).toString('ascii'));
		offset += length;
	}

	return { name: labels.join('.').toLowerCase(), end: offset + 1 };
};

const encodeName = (name: string): Buffer => Buffer.concat([
	...name.split('.').filter(Boolean).map((label) => {
		const value = Buffer.from(label, 'ascii');
		return Buffer.concat([ Buffer.from([ value.length ]), value ]);
	}),
	Buffer.from([ 0 ]),
]);

const buildRecord = (name: Buffer, type: number, value: Buffer): Buffer => {
	const record = Buffer.alloc(name.length + 10 + value.length);
	name.copy(record, 0);
	record.writeUInt16BE(type, name.length);
	record.writeUInt16BE(1, name.length + 2);
	record.writeUInt32BE(60, name.length + 4);
	record.writeUInt16BE(value.length, name.length + 8);
	value.copy(record, name.length + 10);
	return record;
};

const buildRootReferral = (query: Buffer, questionEnd: number): Buffer => {
	const header = Buffer.alloc(12);
	header.writeUInt16BE(query.readUInt16BE(0), 0);
	header.writeUInt16BE(0x8400, 2);
	header.writeUInt16BE(1, 4);
	header.writeUInt16BE(1, 6);
	header.writeUInt16BE(1, 10);

	const nameServer = encodeName('127.0.0.1');
	const answer = buildRecord(Buffer.from([ 0xc0, 0x0c ]), 2, nameServer);
	const additional = buildRecord(nameServer, 1, Buffer.from([ 127, 0, 0, 1 ]));

	return Buffer.concat([ header, query.subarray(12, questionEnd), answer, additional ]);
};

const buildResponse = (query: Buffer): Buffer | undefined => {
	if (query.length < 17) {
		return;
	}

	const { name, end } = readName(query, 12);
	const queryType = query.readUInt16BE(end);
	const questionEnd = end + 4;

	if (name === '' && queryType === 2) {
		return buildRootReferral(query, questionEnd);
	}

	const response = responses[name] ?? 'nxdomain';

	if (response === 'silent') {
		return;
	}

	const rcode = response === 'nxdomain' ? 3 : response === 'servfail' ? 2 : 0;
	const answerValue = response === 'a' ? Buffer.from([ 127, 0, 0, 1 ]) : response === 'aaaa'
		? Buffer.from([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 ])
		: response === 'txt' ? Buffer.concat([ Buffer.from([ 20 ]), Buffer.from('compatibility output', 'ascii') ])
			: undefined;
	const header = Buffer.alloc(12);
	header.writeUInt16BE(query.readUInt16BE(0), 0);
	header.writeUInt16BE(name === 'trace.compat.test' ? 0x8400 : 0x8180 + rcode, 2);
	header.writeUInt16BE(1, 4);
	header.writeUInt16BE(answerValue ? 1 : 0, 6);

	if (!answerValue) {
		return Buffer.concat([ header, query.subarray(12, questionEnd) ]);
	}

	const answer = buildRecord(Buffer.from([ 0xc0, 0x0c ]), queryType, answerValue);

	return Buffer.concat([ header, query.subarray(12, questionEnd), answer ]);
};

export class DnsServer {
	private constructor (
		private readonly udp: UdpSocket,
		private readonly tcp: TcpServer,
		readonly host: string,
		readonly port: number,
	) {}

	static async start (host: string): Promise<DnsServer> {
		for (let attempt = 0; attempt < maximumStartAttempts; attempt++) {
			const udp = createSocket(host.includes(':') ? 'udp6' : 'udp4');
			let tcp: TcpServer | undefined;

			try {
				await bind(udp, 0, host);
				const port = (udp.address() as { port: number }).port;
				tcp = createTcpServer(socket => this.handleTcp(socket));
				await listen(tcp, port, host);

				udp.on('message', (query, remote) => {
					const response = buildResponse(query);

					if (response) {
						udp.send(response, remote.port, remote.address);
					}
				});

				return new DnsServer(udp, tcp, host, port);
			} catch (error) {
				await Promise.all([
					closeQuietly(() => closeUdp(udp)),
					...(tcp ? [ closeQuietly(() => closeTcp(tcp)) ] : []),
				]);

				if (tcp && isAddressInUse(error) && attempt < maximumStartAttempts - 1) {
					continue;
				}

				throw error;
			}
		}

		throw new Error('Unable to start DNS server.');
	}

	static async getUnusedPort (host: string): Promise<number> {
		const server = createTcpServer();
		await listen(server, 0, host);
		const port = (server.address() as { port: number }).port;
		await closeTcp(server);
		return port;
	}

	async close (): Promise<void> {
		await Promise.all([ closeUdp(this.udp), closeTcp(this.tcp) ]);
	}

	private static handleTcp (socket: Socket) {
		let buffer = Buffer.alloc(0);

		socket.on('data', (chunk: Buffer) => {
			buffer = Buffer.concat([ buffer, chunk ]);

			while (buffer.length >= 2) {
				const queryLength = buffer.readUInt16BE(0);

				if (buffer.length < queryLength + 2) {
					return;
				}

				const response = buildResponse(buffer.subarray(2, queryLength + 2));
				buffer = buffer.subarray(queryLength + 2);

				if (response) {
					const frame = Buffer.alloc(response.length + 2);
					frame.writeUInt16BE(response.length, 0);
					response.copy(frame, 2);
					socket.write(frame);
				}
			}
		});
	}
}
