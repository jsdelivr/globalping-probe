import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess} from 'execa';
import type {CommandInterface} from '../types.js';
import {isExecaError} from '../helper/execa-error-check.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

import type {ResultType} from './handlers/mtr/types.js';
import MtrParser from './handlers/mtr/parser.js';

type MtrOptions = {
	type: string;
	target: string;
	protocol: string;
	port: number;
	packets: number;
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
			result.hops = MtrParser.hopsParse(result.hops, data.toString());
			result.rawOutput = MtrParser.outputBuilder(result.hops);

			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {
					...result,
				},
			});
		});

		try {
			const cmdResult = await cmd;
			result.hops = MtrParser.hopsParse([], cmdResult.stdout, true);
			result.rawOutput = MtrParser.outputBuilder(result.hops);
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
}
