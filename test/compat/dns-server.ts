import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import {
	createTCPServer,
	createUDPServer,
	Packet,
	type DnsHandler,
	type TCPServer as DnsTcpServer,
	type UDPServer as DnsUdpServer,
} from 'dns2';

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

const bind = (socket: DnsUdpServer, port: number, host: string): Promise<void> => new Promise((resolve, reject) => {
	socket.once('error', reject);

	socket.bind(port, host, () => {
		socket.off('error', reject);
		resolve();
	});
});

const closeTcp = (server: TcpServer): Promise<void> => new Promise((resolve, reject) => {
	server.close(error => error ? reject(error) : resolve());
});

const closeUdp = (socket: DnsUdpServer): Promise<void> => new Promise((resolve) => {
	socket.close(resolve);
});

const closeQuietly = async (close: () => Promise<void>): Promise<void> => {
	try {
		await close();
	} catch {}
};

const isAddressInUse = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'EADDRINUSE';

const buildRootReferral = (request: Packet): Packet => {
	const response = Packet.createResponseFromRequest(request);

	response.header.aa = 1;

	response.answers.push(new Packet.Resource({
		name: '',
		type: Packet.TYPE.NS,
		class: Packet.CLASS.IN,
		ttl: 60,
		ns: '127.0.0.1',
	}));

	response.additionals.push(new Packet.Resource({
		name: '127.0.0.1',
		type: Packet.TYPE.A,
		class: Packet.CLASS.IN,
		ttl: 60,
		address: '127.0.0.1',
	}));

	return response;
};

const buildResponse = (request: Packet): Packet | undefined => {
	const [ question ] = request.questions;

	if (!question) {
		return;
	}

	const name = question.name.toLowerCase();

	if (name === '' && question.type === Packet.TYPE.NS) {
		return buildRootReferral(request);
	}

	const responseType = responses[name] ?? 'nxdomain';

	if (responseType === 'silent') {
		return;
	}

	const response = Packet.createResponseFromRequest(request);
	response.header.rcode = responseType === 'nxdomain' ? Packet.RCODE.NXDOMAIN
		: responseType === 'servfail' ? Packet.RCODE.SERVFAIL
			: Packet.RCODE.NOERROR;

	if (name === 'trace.compat.test') {
		response.header.aa = 1;
	} else {
		response.header.ra = 1;
	}

	const answer = Packet.createResourceFromQuestion(question, { ttl: 60 });

	if (responseType === 'a') {
		answer.address = '127.0.0.1';
	} else if (responseType === 'aaaa') {
		answer.address = '::1';
	} else if (responseType === 'txt') {
		answer.data = 'compatibility output';
	} else {
		return response;
	}

	response.answers.push(answer);
	return response;
};

const handleRequest: DnsHandler = (request, send) => {
	const response = buildResponse(request);

	if (response) {
		Promise.resolve(send(response)).catch(() => {});
	}
};

export class DnsServer {
	private constructor (
		private readonly udp: DnsUdpServer,
		private readonly tcp: DnsTcpServer,
		readonly host: string,
		readonly port: number,
	) {}

	static async start (host: string): Promise<DnsServer> {
		for (let attempt = 0; attempt < maximumStartAttempts; attempt++) {
			const udp = createUDPServer({ type: host.includes(':') ? 'udp6' : 'udp4' });
			let tcp: DnsTcpServer | undefined;

			try {
				udp.on('request', handleRequest);
				await bind(udp, 0, host);
				const port = (udp.address() as { port: number }).port;
				tcp = createTCPServer(handleRequest);
				await listen(tcp, port, host);

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
}
