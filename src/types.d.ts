import {type Socket} from 'socket.io-client';
import type {PingOptions} from './command/ping-command';
import type {DnsOptions} from './command/dns-command';
import type {TraceOptions} from './command/traceroute-command';
import type {MtrOptions} from './command/mtr-command';
import type {HttpOptions} from './command/http-command';

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
};

type ProbeLocation = {
	continent: string;
	region: string;
	country: string;
	city: string;
	asn: string;
	latitude: string;
	longitude: string;
	state: string | undefined;
};

type WsApiError = {
	message: string;
	info: {
		socketId: string;
		code?: string;
		probe?: Probe;
		cause?: {
			probe?: Probe;
		};
	};
};
