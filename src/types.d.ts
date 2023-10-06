import { type Socket } from 'socket.io-client';
import type { PingOptions } from './command/ping-command.js';
import type { DnsOptions } from './command/dns-command.js';
import type { TraceOptions } from './command/traceroute-command.js';
import type { MtrOptions } from './command/mtr-command.js';
import type { HttpOptions } from './command/http-command.js';

type MeasurementRequest = {
	measurementId: string;
	testId: string;
	measurement: PingOptions | DnsOptions | TraceOptions | MtrOptions | HttpOptions;
};

type CommandInterface<OPT> = {
	run(socket: Socket, measurementId: string, testId: string, options: OPT): Promise<void>;
};

type Probe = {
	location: ProbeLocation;
	ipAddress?: string;
};

type ProbeLocation = {
	continent: string;
	region: string;
	country: string;
	city: string;
	asn: string;
	latitude: string;
	longitude: string;
	network: string;
	state: string | undefined;
};
