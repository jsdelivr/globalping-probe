import {Socket} from 'socket.io-client';

type MeasurementRequest = {
	id: string;
	measurement: {
		type: string;
	};
};

// eslint-disable-next-line @typescript-eslint/naming-convention
interface CommandInterface<OPT> {
	run(socket: Socket, measurementId: string, testId: string, options: OPT): Promise<void>;
}

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
