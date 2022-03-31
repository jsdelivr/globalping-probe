import Joi from 'joi';
import type {Socket} from 'socket.io-client';
import {execa, ExecaChildProcess, ExecaError} from 'execa';
import type {CommandInterface} from '../types.js';
import {InvalidOptionsException} from './exception/invalid-options-exception.js';

type PingOptions = {
	type: 'ping';
	target: string;
	packets: number;
};

const pingOptionsSchema = Joi.object<PingOptions>({
	type: Joi.string().valid('ping'),
	target: Joi.string(),
	packets: Joi.number().min(1).max(16).default(3),
});

export const pingCmd = (options: PingOptions): ExecaChildProcess => {
	const args = [
		['-c', options.packets.toString()],
		['-i', '0.2'],
		['-w', '15'],
		'-n',
		options.target,
	].flat();

	return execa('ping', args);
};

export class PingCommand implements CommandInterface<PingOptions> {
	constructor(private readonly cmd: typeof pingCmd) {}

	async run(socket: Socket, measurementId: string, testId: string, options: unknown): Promise<void> {
		const {value: cmdOptions, error} = pingOptionsSchema.validate(options);

		if (error) {
			throw new InvalidOptionsException('ping', error);
		}

		const cmd = this.cmd(cmdOptions);
		cmd.stdout?.on('data', (data: Buffer) => {
			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {rawOutput: data.toString()},
			});
		});

		let result = {};

		try {
			const cmdResult = await cmd;
			result = this.parse(cmdResult.stdout);
		} catch (error: unknown) {
			result = {
				rawOutput: (error as ExecaError).stderr?.toString() ?? '',
			};
		}

		socket.emit('probe:measurement:result', {
			testId,
			measurementId,
			result,
		});
	}

	private parse(rawOutput: string) {
		const lines = rawOutput.split('\n');
		if (lines.length === 0) {
			return {rawOutput};
		}

		const header = /^PING\s.*\s\((?<addr>.+?)\)/.exec(lines.shift()!);
		if (!header) {
			return {rawOutput};
		}

		const resolvedAddress = header?.groups?.['addr'];
		const statsLines = [];

		let line;
		while ((line = lines.shift())) {
			const stats = this.parseStatsLine(line);
			if (!stats) {
				continue;
			}

			statsLines.push(stats);
		}

		const summary = this.parseSummary(lines.splice(1));

		return {resolvedAddress, times: statsLines, ...summary, rawOutput};
	}

	private parseStatsLine(line: string) {
		const parsed = /^\d+ bytes from .*: (?:icmp_)?seq=\d+ ttl=(?<ttl>\d+) time=(?<time>\d*(?:\.\d+)?) ms/.exec(line);

		if (!parsed || !parsed.groups) {
			return;
		}

		return {
			ttl: Number.parseInt(parsed.groups['ttl'] ?? '-1', 10),
			time: Number.parseFloat(parsed.groups['time'] ?? '-1'),
		};
	}

	private parseSummary(lines: string[]) {
		const [packets, rtt] = lines;
		const result: Record<string, any> = {};

		if (rtt) {
			const rttMatch = /^(?:round-trip|rtt)\s.*\s=\s(?<min>\d*(?:\.\d+)?)\/(?<avg>\d*(?:\.\d+)?)\/(?<max>\d*(?:\.\d+)?)?/.exec(rtt);

			result['min'] = Number.parseFloat(rttMatch?.groups?.['min'] ?? '');
			result['avg'] = Number.parseFloat(rttMatch?.groups?.['avg'] ?? '');
			result['max'] = Number.parseFloat(rttMatch?.groups?.['max'] ?? '');
		}

		if (packets) {
			const packetsMatch = /(?<loss>\d*(?:\.\d+)?)%\spacket\sloss/.exec(packets);
			result['loss'] = Number.parseFloat(packetsMatch?.groups?.['loss'] ?? '-1');
		}

		return result;
	}
}
