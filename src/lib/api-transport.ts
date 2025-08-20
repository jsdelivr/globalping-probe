import Transport from 'winston-transport';
import { Socket } from 'socket.io-client';

export type ApiTransportSettings = {
	enabled?: boolean;
	bufferSize?: number;
	sendInterval?: number;
};

export type ApiTransportOptions = Transport.TransportStreamOptions & {
	sendingEnabled?: boolean;
	bufferSize?: number;
	sendInterval?: number; // how often logs should be sent (ms)
	socket?: Socket;
};

type Info = {
	message: string;
	timestamp: string;
	level: string;
	type: string;
};

class ApiTransport extends Transport {
	public sendingEnabled: boolean;
	public bufferSize: number;
	public sendInterval: number;
	public socket: Socket | undefined;
	private logBuffer: Info[] = [];
	private droppedLogs: number = 0;
	private timer: NodeJS.Timeout | undefined = undefined;

	constructor (opts?: ApiTransportOptions) {
		super(opts);
		this.sendingEnabled = opts?.sendingEnabled ?? false;
		this.bufferSize = opts?.bufferSize ?? 100;
		this.sendInterval = opts?.sendInterval ?? 10000;
		this.socket = opts?.socket;
		this._setInterval();
	}

	override log (info: Info, callback?: () => void) {
		setImmediate(() => this.emit('logged', info));

		this.logBuffer.push(info);
		const bufferLength = this.logBuffer.length;
		const bufferOverflow = bufferLength - this.bufferSize;

		if (bufferOverflow > 0) {
			this.logBuffer = this.logBuffer.slice(bufferOverflow);
			this.droppedLogs += bufferOverflow;
		}

		callback && callback();
	}

	_setInterval () {
		this.timer && clearInterval(this.timer);

		if (this.sendingEnabled) {
			this.timer = setInterval(() => this._sendLogs(), this.sendInterval);
		}
	}

	_sendLogs () {
		if (!this.sendingEnabled || !this.socket?.connected || !this.logBuffer.length) {
			return;
		}

		const payload = {
			logs: this.logBuffer,
			skipped: this.droppedLogs,
		};

		this.socket.emit('probe:logs', payload);
		this.logBuffer = [];
		this.droppedLogs = 0;
	}

	updateSettings (data: ApiTransportSettings) {
		this.sendingEnabled = data.enabled ?? this.sendingEnabled;
		this.bufferSize = data.bufferSize ?? this.bufferSize;
		this.sendInterval = data.sendInterval ?? this.sendInterval;
		this._setInterval();
	}
}

export default ApiTransport;
