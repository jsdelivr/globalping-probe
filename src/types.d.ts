import {Socket} from 'socket.io-client';

type MeasurementRequest = {
	id: string;
	measurement: {
		type: string;
	};
};

interface CommandInterface<OPT> {
	run(socket: Socket, measurementId: string, testId: string, options: OPT): Promise<void>;
}
