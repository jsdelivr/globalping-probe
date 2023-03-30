import {type Socket} from 'socket.io-client';

type MeasurementRequest = {
	measurementId: string;
	testId: string;
	measurement: {
		type: string;
	};
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
