import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import dig, {DnsQueryResult} from 'node-dig-dns';
import type {CommandInterface} from '../types.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

type DnsOptions = {
	type: 'dns';
	target: string;
	query: {
		type?: string[];
		resolver?: string;
		protocol?: string;
		port?: number;
	};
};

const allowedTypes = ['A', 'AAAA', 'ANY', 'CNAME', 'DNSKEY', 'DS', 'MX', 'NS', 'NSEC', 'PTR', 'RRSIG', 'SOA', 'TXT', 'SRV'];
const allowedProtocols = ['UDP', 'TCP'];

const dnsOptionsSchema = Joi.object<DnsOptions>({
	type: Joi.string().valid('dns'),
	target: Joi.string(),
	query: Joi.object({
		type: Joi.string().valid(...allowedTypes).optional().default('A'),
		resolver: Joi.string().optional(),
		protocol: Joi.string().valid(...allowedProtocols).optional().default('udp'),
		port: Joi.number().optional().default('53'),
	}),
});

export const dnsCmd = async (options: DnsOptions): Promise<DnsQueryResult> => {
	const protocolArg = options.query.protocol?.toLowerCase() === 'tcp' ? '+tcp' : [];
	const resolverArg = options.query.resolver ? `@${options.query.resolver}` : [];

	const args = [
		options.target,
		resolverArg,
		['-t', options.query.type],
		['-p', options.query.port],
		'-4', '+time=1', '+tries=2',
		protocolArg,
	].flat() as string[];

	return dig(args);
};

export class DnsCommand implements CommandInterface<DnsOptions> {
	constructor(private readonly cmd: typeof dnsCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error} = dnsOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('dns', error);
		}

		const result = await this.cmd(cmdOptions);

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result: result.answer,
		});
	}
}
