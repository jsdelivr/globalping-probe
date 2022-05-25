import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

type MtrOptions = {
	type: string;
	target: string;
	protocol: string;
	port: number;
	packets: number;
};

type HopTimesType = {
	seq: string;
	time?: number;
};

type HopType = {
	host?: string;
	resolvedHost?: string;
	stats?: {
		min?: number;
		max?: number;
		avg?: number;
		total?: number;
		loss?: number;
	};
	times: HopTimesType[];
};

type ResultType = {
	hops: HopType[];
	rawOutput: string;
};

const mtrOptionsSchema = Joi.object<MtrOptions>({
	type: Joi.string().valid('mtr'),
	target: Joi.string(),
	protocol: Joi.string().lowercase().insensitive(),
	packets: Joi.number().min(1).max(16).default(3),
	port: Joi.number(),
});

export const mtrCmd = (options: MtrOptions): ExecaChildProcess => {
	const protocolArg = options.protocol === 'icmp' ? null : options.protocol;
	const packetsArg = String(options.packets);

	const args = [
		// Ipv4
		'-4',
		['-o', 'LDRAVM'],
		'--aslookup',
		'--show-ips',
		['--interval', '1'],
		['--gracetime', '3'],
		['--max-ttl', '20'],
		['--timeout', '15'],
		protocolArg ? `--${protocolArg}` : [],
		['-c', packetsArg],
		['--raw'],
		options.target,
	].flat();

	return execa('mtr', args);
};

export class MtrCommand implements CommandInterface<MtrOptions> {
	constructor(private readonly cmd: typeof mtrCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error} = mtrOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('mtr', error);
		}

		const cmd = this.cmd(cmdOptions);
		const result: ResultType = {
			hops: [],
			rawOutput: '',
		};

		cmd.stdout?.on('data', (data: Buffer) => {
			result.hops = MtrCommand.partialHopsParse(result.hops, data);

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {
					...result,
					rawOutput: '',
				},
			});
		});

		try {
			await cmd;
		} catch (error: unknown) {
			const output = isExecaError(error) ? error.stderr.toString() : '';

			result.rawOutput = output;
		}

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result,
		});
	}

	static partialHopsParse(currentHops: HopType[], data: Buffer): HopType[] {
		const sData = data.toString().split('\n');

		const hops = [...currentHops];

		for (const row of sData) {
			const [action, index, ...value] = row.split(' ');

			if (!action || !index || !value) {
				continue;
			}

			const entry: HopType = {
				times: [],
				...hops[Number(index)],
			};

			switch (action) {
				case 'h': {
					const [host] = value;

					if (!host) {
						break;
					}

					entry.host = host;
					break;
				}

				case 'd': {
					const [host] = value;

					if (!host) {
						break;
					}

					entry.resolvedHost = host;
					break;
				}

				case 'x': {
					const [seq] = value;

					if (!seq) {
						break;
					}

					entry.times.push({seq});
					break;
				}

				case 'p': {
					const [time, seq] = value;

					const timesArray = entry.times.map(t => t.seq === seq
						? {...t, time: Number(time) / 1000}
						: t,
					);

					entry.times = timesArray ?? [];
					break;
				}

				default:
					break;
			}

			hops[Number(index)] = entry;
		}

		return hops;
	}
}
