import Transport from 'winston-transport';
import { Socket } from 'socket.io-client';
import { Logger } from 'winston';

export type ApiTransportSettings = {
	isActive?: boolean;
	sendInterval?: number;
	maxBufferSize?: number;
};

export type ApiTransportOptions = Transport.TransportStreamOptions & ApiTransportSettings & { socket?: Socket };

type Info = {
	message: string;
	timestamp: string;
	level: string;
	scope: string;
};

class ApiLogsTransport extends Transport {
	private logger: Logger | undefined;
	private socket: Socket | undefined;
	private isActive: boolean;
	private sendInterval: number;
	private maxBufferSize: number;
	private logBuffer: Info[] = [];
	private droppedLogs: number = 0;
	private timer: NodeJS.Timeout | undefined = undefined;

	constructor (opts?: ApiTransportOptions) {
		super(opts);
		this.isActive = opts?.isActive ?? false;
		this.sendInterval = opts?.sendInterval ?? 10000;
		this.maxBufferSize = opts?.maxBufferSize ?? 100;
		this.socket = opts?.socket;
		this.scheduleSend();
	}

	override log (info: Info, callback?: () => void) {
		setImmediate(() => this.emit('logged', info));

		this.logBuffer.push(info);
		const bufferLength = this.logBuffer.length;
		const bufferOverflow = bufferLength - this.maxBufferSize;

		if (bufferOverflow > 0) {
			this.logBuffer.splice(0, bufferOverflow);
			this.droppedLogs += bufferOverflow;
		}

		callback && callback();
	}

	setSocket (socket: Socket) {
		this.socket = socket;
	}

	setLogger (logger: Logger) {
		this.logger = logger;
	}

	getCurrentSettings () {
		return {
			isActive: this.isActive,
			sendInterval: this.sendInterval,
			maxBufferSize: this.maxBufferSize,
		};
	}

	updateSettings (settings: ApiTransportSettings) {
		this.isActive = settings.isActive ?? this.isActive;
		this.sendInterval = settings.sendInterval ?? this.sendInterval;
		this.maxBufferSize = settings.maxBufferSize ?? this.maxBufferSize;
		this.scheduleSend();
	}

	private scheduleSend () {
		clearTimeout(this.timer);

		if (this.isActive) {
			this.timer = setTimeout(() => {
				void this.sendLogs();
			}, this.sendInterval);
		}
	}

	private async sendLogs () {
		if (!this.isActive || !this.socket?.connected || !this.logBuffer.length) {
			return this.scheduleSend();
		}

		const payload = {
			logs: this.logBuffer.slice(),
			skipped: this.droppedLogs,
		};

		const droppedInPayload = payload.skipped;
		const presentInPayload = payload.logs.length;

		try {
			const response: unknown = await this.socket.emitWithAck('probe:logs', payload);

			if (response === 'success') {
				const droppedWhileAwaiting = this.droppedLogs - droppedInPayload;
				const oldLogsRemaining = presentInPayload - droppedWhileAwaiting;

				if (oldLogsRemaining >= 0) {
					this.logBuffer.splice(0, oldLogsRemaining);
					this.droppedLogs = 0;
				} else {
					this.droppedLogs = -oldLogsRemaining; // === droppedWhileAwaiting - presentInPayload
				}
			}
		} catch (e) {
			this.logger?.error('Failed to send logs to the API.', e);
		} finally {
			this.scheduleSend();
		}
	}
}

export default ApiLogsTransport;
