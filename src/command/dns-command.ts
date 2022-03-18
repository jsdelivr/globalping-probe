import {getServers as getDnsServers} from 'node:dns';
import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import domain from 'domain-info';
import type {CommandInterface} from '../types.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

type SingleDnsQueryResult = {
	name: string;
	type: string;
	class: string;
	address?: string;
	primary?: string;
	admin?: string;
	serial?: number;
	refresh?: number;
	retry?: number;
	expiration?: number;
	minimum?: number;
	data?: string[];
};

type DnsQueryResult = Record<string, SingleDnsQueryResult[]>;

type DnsOptions = {
	type: 'dns';
	target: string;
	query: {
		types?: string[];
		address?: string;
		protocol?: string;
		port?: number;
	};
};

const defaultTypes = ['A', 'AAAA', 'ANY', 'CNAME', 'DNSKEY', 'DS', 'MX', 'NS', 'NSEC', 'PTR', 'RRSIG', 'SOA', 'TXT', 'SRV'];

const dnsOptionsSchema = Joi.object<DnsOptions>({
	type: Joi.string().valid('dns'),
	target: Joi.string(),
	query: Joi.object({
		types: Joi.array().items(Joi.string().valid(...defaultTypes)).optional(),
		address: Joi.string().optional(),
		protocol: Joi.string().valid('TCP', 'UDP').optional(),
		port: Joi.number().optional(),
	}),
});

export const dnsCmd = async (options: DnsOptions): Promise<DnsQueryResult> => domain.groper(
	options.target,
	options.query.types ?? defaultTypes,
	{
		server: {
			type: options.query.protocol ?? 'UDP',
			address: options.query.address ?? getDnsServers().pop()!,
			port: options.query.port ?? 53,
		},
	}) as DnsQueryResult;

export class DnsCommand implements CommandInterface<DnsOptions> {
	constructor(private readonly cmd: typeof dnsCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error} = dnsOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('dns', error);
		}

		const result = await this.cmd(cmdOptions);

		console.log(result);

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result,
		});
	}
}
