import _ from 'lodash';
import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import { execa, type ExecaChildProcess } from 'execa';
import type { CommandInterface, FailureSource } from '../types.js';
import { isExecaError } from '../helper/execa-error-check.js';
import { ProgressBuffer } from '../helper/progress-buffer.js';
import { ipEquals, joiValidateIp, isIpPrivate, normalizeIp } from '../lib/ip.js';
import { scopedLogger } from '../lib/logger.js';
import { byLine } from '../lib/by-line.js';
import { InvalidOptionsException } from './exception/invalid-options-exception.js';
import { createMeasurementDeadline, getProcessTimeout, getTracerouteBudget } from '../helper/timeout.js';
import { validateCommandOptions } from '../helper/validate-command-options.js';
import { getNativeNameResolutionFailureSource } from '../helper/native-name-resolution-failure.js';
import { resolveCommandTarget, type CommandTargetLookup, ResolvedCommandTarget } from '../helper/resolve-command-target.js';
import { AsyncLookupMap } from '../helper/async-lookup-map.js';
import { getFailureSource, isExposed } from '../lib/internal-error.js';
import type { IpFamily } from '../lib/dns.js';

const ipAddressPattern = String.raw`(?:\d+\.){3}\d+|[\da-fA-F]*:[\da-fA-F:.]+`;
const reHost = new RegExp(String.raw`(\S+?)(%\w+)?(\s+)\((${ipAddressPattern})(%\w+)?\)`);
const reAddress = new RegExp(String.raw`(^|\s)(${ipAddressPattern})(%\w+)?(?=\s|$)`, 'g');
const reRtt = /(\d+(?:\.?\d+)?)\s+ms(!\S*)?/g;
const traceroutePackets = 2;

const toJsonHost = (value: string): string | null => value === '*' ? null : value;

export type TraceOptions = {
	type: 'traceroute';
	inProgressUpdates: boolean;
	target: string;
	protocol: string;
	port: number;
	ipVersion: number;
	timeout: number;
};

type ParsedHop = {
	resolvedAddress: string;
	resolvedHostname: string;
	timings: Array<{ rtt: number }>;
};

type ParsedLineOutput = {
	rawOutput: string;
	hop: ParsedHop;
	responderAddresses: string[];
};

type ParsedOutput = {
	rawOutput: string;
	hops: ParsedHop[];
	responderAddresses: string[];
};

type ResolvedParsedOutput = ParsedOutput & {
	resolvedAddress: string;
	resolvedHostname: string;
};

type FinishedTracerouteResult = {
	rawOutput: string;
	status: 'finished';
	resolvedAddress: string | null;
	resolvedHostname: string | null;
	hops: Array<{
		resolvedAddress: string | null;
		resolvedHostname: string | null;
		timings: Array<{ rtt: number }>;
	}>;
};

type FailedTracerouteResult = {
	status: 'failed';
	failureSource: FailureSource;
	rawOutput: string;
};

type TracerouteResult = FinishedTracerouteResult | FailedTracerouteResult;

type NormalizeTracerouteOutputOptions = {
	hideGatewayHostname?: boolean;
};

const logger = scopedLogger('traceroute-command');

export const normalizeTracerouteOutput = (
	output: string,
	targetAddress: string,
	targetHostname: string,
	responderAddresses: Iterable<string>,
	hostnames: Pick<ReadonlyMap<string, string>, 'get'>,
	{ hideGatewayHostname = false }: NormalizeTracerouteOutputOptions = {},
): string => {
	const lines = output.split('\n');
	const addressPattern = Array.from(new Set(responderAddresses))
		.sort((first, second) => second.length - first.length)
		.map(address => _.escapeRegExp(address))
		.join('|');
	const responderPattern = addressPattern ? new RegExp(`(^|\\s)(${addressPattern})(%\\w+)?(?=\\s|$)`, 'g') : null;

	if (lines[0]) {
		lines[0] = lines[0].replace(
			`traceroute to ${targetAddress} (${targetAddress})`,
			`traceroute to ${targetHostname} (${targetAddress})`,
		);
	}

	return lines.map((line, index) => {
		if (index === 0) {
			return line;
		}

		const normalizedLine = responderPattern ? line.replace(responderPattern, (_match, prefix: string, address: string, scopeId: string | undefined) => {
			const displayAddress = `${address}${scopeId ?? ''}`;
			const hostname = hostnames.get(address) ?? displayAddress;
			return `${prefix}${hostname} (${displayAddress})`;
		}) : line;

		return hideGatewayHostname && index === 1
			? normalizedLine.replace(reHost, '_gateway$3($4$5)')
			: normalizedLine;
	}).join('\n');
};

const upstreamUnreachablePattern = /(?:^|\s)!(?:N|H|P|X|S|F|V|C|\d+)(?:\s|$)/m;

const classifyTracerouteFailure = (
	error: unknown,
	output: string,
	targetResponded: boolean,
): FailureSource => {
	const nameResolutionSource = getNativeNameResolutionFailureSource(output);

	if (nameResolutionSource) {
		return nameResolutionSource;
	}

	if (isExecaError(error) && error.timedOut) {
		if (targetResponded) {
			return 'internal';
		}

		const hasUnansweredProbe = /^\s*\d+\s+(?:\S+\s+)*\*/m.test(output);
		return hasUnansweredProbe ? 'target' : 'internal';
	}

	return upstreamUnreachablePattern.test(output) ? 'target' : 'internal';
};

const allowedIpVersions = [ 4, 6 ];

const traceOptionsSchema = Joi.object<TraceOptions>({
	type: Joi.string().valid('traceroute'),
	inProgressUpdates: Joi.boolean(),
	target: Joi.string().custom(joiValidateIp).required(),
	protocol: Joi.string(),
	port: Joi.number(),
	ipVersion: Joi.when(Joi.ref('target'), {
		is: Joi.string().ip({ version: [ 'ipv4' ], cidr: 'forbidden' }).required(),
		then: Joi.valid(4).default(4),
		otherwise: Joi.when(Joi.ref('target'), {
			is: Joi.string().ip({ version: [ 'ipv6' ], cidr: 'forbidden' }).required(),
			then: Joi.valid(6).default(6),
			otherwise: Joi.valid(...allowedIpVersions).default(4),
		}),
	}),
	timeout: Joi.number().integer(),
});

export const argBuilder = (options: TraceOptions): string[] => {
	const port = options.protocol === 'TCP' ? [ '-p', `${options.port}` ] : [];
	const { wait } = getTracerouteBudget(options.timeout, traceroutePackets);

	const args = [
		'-n',
		// Ipv4 or IPv6
		`-${options.ipVersion}`,
		// Max ttl
		[ '-m', '20' ],
		// Reserve 40% for DNS and overhead; the packets share the rest.
		[ '-w', String(wait) ],
		// Probe packets per hop
		[ '-q', String(traceroutePackets) ],
		// Concurrent packets
		[ '-N', '20' ],
		// Protocol
		`--${options.protocol.toLowerCase()}`,
		// Port
		port,
		// Target
		options.target,
	].flat();

	return args;
};

export const traceCmd = (options: TraceOptions, processTimeout = getProcessTimeout(options.timeout)): ExecaChildProcess => {
	const args = argBuilder(options);
	return execa('unbuffer', [ 'traceroute', ...args ], { timeout: processTimeout });
};

export class TracerouteCommand implements CommandInterface<TraceOptions> {
	constructor (private readonly cmd: typeof traceCmd, private readonly lookup: CommandTargetLookup) {}

	async run (socket: Socket, measurementId: string, testId: string, options: TraceOptions): Promise<unknown> {
		const validationResult = validateCommandOptions(traceOptionsSchema, options);

		if (validationResult.error) {
			throw new InvalidOptionsException('traceroute', validationResult.error);
		}

		const { value: cmdOptions } = validationResult;
		const buffer = new ProgressBuffer(socket, testId, measurementId, 'diff');
		const deadline = createMeasurementDeadline(cmdOptions.timeout);
		const { dnsHeadroom } = getTracerouteBudget(cmdOptions.timeout, traceroutePackets);
		let result: TracerouteResult;
		let target: ResolvedCommandTarget | undefined;

		try {
			target = await resolveCommandTarget(cmdOptions.target, cmdOptions.ipVersion as IpFamily, deadline.signalFor(dnsHeadroom), this.lookup);
			const resolvedTarget = target;
			const targetHostnames = new Map([ [ resolvedTarget.address, resolvedTarget.hostname ] ]);

			const commandOptions = { ...cmdOptions, target: resolvedTarget.address };
			const cmd = this.cmd(commandOptions, deadline.processTimeout());
			const signal = deadline.signal();
			const hostnames = new AsyncLookupMap<string, string>(address => this.lookup(address, { rrtype: 'PTR', signal }));
			hostnames.set(resolvedTarget.address, resolvedTarget.hostname);

			const parseAndStartLookups = (output: string): ParsedOutput => {
				const parsed = this.parse(output);

				for (const address of parsed.responderAddresses) {
					if (address !== resolvedTarget.address && !isIpPrivate(address)) {
						hostnames.add(address);
					}
				}

				return parsed;
			};

			const formatOutput = (
				parsed: ParsedOutput,
				resolvedHostnames: Pick<ReadonlyMap<string, string>, 'get'>,
			): ResolvedParsedOutput => {
				const rawOutput = normalizeTracerouteOutput(
					parsed.rawOutput,
					resolvedTarget.address,
					resolvedTarget.hostname,
					parsed.responderAddresses,
					resolvedHostnames,
					{ hideGatewayHostname: true },
				);

				return {
					...parsed,
					rawOutput,
					resolvedAddress: resolvedTarget.address,
					resolvedHostname: resolvedTarget.hostname,
					hops: parsed.hops.map((hop, index) => {
						if (index === 0) {
							return hop.resolvedAddress === '*' ? hop : { ...hop, resolvedHostname: '_gateway' };
						}

						const hostname = resolvedHostnames.get(hop.resolvedAddress);
						return hostname ? { ...hop, resolvedHostname: hostname } : hop;
					}),
				};
			};

			if (cmd.stdout && cmdOptions.inProgressUpdates) {
				const pStdout: string[] = [];
				byLine(cmd.stdout, (data) => {
					pStdout.push(data);

					const parsed = formatOutput(parseAndStartLookups(pStdout.join('')), targetHostnames);
					buffer.pushProgress({ rawOutput: parsed.rawOutput });
				});
			}

			const cmdResult = await cmd;

			if (cmdResult.stdout.length === 0) {
				logger.error('Successful stdout is empty.', cmdResult);
			}

			const parsedOutput = parseAndStartLookups(cmdResult.stdout.trim());
			await hostnames.wait();
			const parseResult = formatOutput(parsedOutput, hostnames);
			result = this.toJsonOutput(parseResult);
		} catch (error: unknown) {
			let output = '';
			let failureSource: FailureSource;

			if (isExecaError(error)) {
				output = error.stdout.toString();
				const parsed = this.parse(output.trim());

				if (target) {
					const targetHostnames = new Map([ [ target.address, target.hostname ] ]);
					output = normalizeTracerouteOutput(output, target.address, target.hostname, parsed.responderAddresses, targetHostnames);
				}

				let targetResponded = false;

				if (error.timedOut) {
					const lastHop = parsed.hops.at(-1);

					targetResponded = !!lastHop
						&& !!target
						&& ipEquals(lastHop.resolvedAddress, target.address)
						&& lastHop.timings.length > 0;

					output += `${output ? '\n\n' : ''}The measurement command timed out.`;
				}

				failureSource = classifyTracerouteFailure(error, output, targetResponded);
			} else {
				failureSource = getFailureSource(error, target ? 'internal' : 'resolver');

				if (error instanceof Error && isExposed(error)) {
					output = error.message;
				} else {
					logger.error(error);
				}
			}

			result = {
				status: 'failed',
				failureSource,
				rawOutput: output || 'Test failed. Please try again.',
			};
		}

		buffer.pushResult(result);
		return result;
	}

	private parse (rawOutput: string): ParsedOutput {
		const lines = rawOutput.split('\n');

		if (!reHost.test(lines[0]!)) {
			return {
				rawOutput,
				hops: [],
				responderAddresses: [],
			};
		}

		const parsedLines = lines.slice(1).map(line => this.parseLine(line));

		return {
			hops: parsedLines.map(line => line.hop),
			rawOutput: [ lines[0], ...parsedLines.map(line => line.rawOutput) ].join('\n'),
			responderAddresses: parsedLines.flatMap(line => line.responderAddresses),
		};
	}

	private toJsonOutput (input: ResolvedParsedOutput): FinishedTracerouteResult {
		return {
			rawOutput: input.rawOutput,
			status: 'finished',
			resolvedAddress: toJsonHost(input.resolvedAddress),
			resolvedHostname: toJsonHost(input.resolvedHostname),
			hops: input.hops.map(hop => ({
				resolvedAddress: toJsonHost(hop.resolvedAddress),
				resolvedHostname: toJsonHost(hop.resolvedHostname),
				timings: hop.timings,
			})),
		};
	}

	private parseLine (line: string): ParsedLineOutput {
		const responderAddresses: string[] = [];
		const rawOutput = line.replace(reAddress, (_match, prefix: string, address: string, scopeId: string | undefined) => {
			const normalizedAddress = normalizeIp(address);
			responderAddresses.push(normalizedAddress);
			return `${prefix}${normalizedAddress}${scopeId ?? ''}`;
		});
		const hostMatch = reHost.exec(rawOutput);
		const address = hostMatch?.[4] ?? responderAddresses[0];
		const rttList = Array.from(line.matchAll(reRtt), m => Number.parseFloat(m[1]!));

		return {
			hop: {
				resolvedHostname: hostMatch?.[1] ?? address ?? '*',
				resolvedAddress: address ?? '*',
				timings: rttList.map(rtt => ({ rtt })),
			},
			responderAddresses,
			rawOutput,
		};
	}
}
