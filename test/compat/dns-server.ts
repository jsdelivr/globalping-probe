import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';

type DnsResponse = 'a' | 'aaaa' | 'nxdomain' | 'servfail' | 'silent';

const responses: Record<string, DnsResponse> = {
	'ipv4.compat.test': 'a',
	'ipv6.compat.test': 'aaaa',
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

const buildResponse = (query: Buffer): Buffer | undefined => {
	if (query.length < 17) {
		return;
	}

	const { name, end } = readName(query, 12);
	const queryType = query.readUInt16BE(end);
	const questionEnd = end + 4;
	const response = responses[name] ?? 'nxdomain';

	if (response === 'silent') {
		return;
	}

	const rcode = response === 'nxdomain' ? 3 : response === 'servfail' ? 2 : 0;
	const answerAddress = response === 'a' ? Buffer.from([ 127, 0, 0, 1 ]) : response === 'aaaa'
		? Buffer.from([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 ])
		: undefined;
	const header = Buffer.alloc(12);
	header.writeUInt16BE(query.readUInt16BE(0), 0);
	header.writeUInt16BE(0x8180 + rcode, 2);
	header.writeUInt16BE(1, 4);
	header.writeUInt16BE(answerAddress ? 1 : 0, 6);

	if (!answerAddress) {
		return Buffer.concat([ header, query.subarray(12, questionEnd) ]);
	}

	const answer = Buffer.alloc(12 + answerAddress.length);
	answer.writeUInt16BE(0xc00c, 0);
	answer.writeUInt16BE(queryType, 2);
	answer.writeUInt16BE(1, 4);
	answer.writeUInt32BE(60, 6);
	answer.writeUInt16BE(answerAddress.length, 10);
	answerAddress.copy(answer, 12);

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
