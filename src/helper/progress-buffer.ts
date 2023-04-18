
import type { Socket } from 'socket.io-client';
import type { DnsParseResponseJson as DnsParseResponseClassicJson } from '../command/handlers/dig/classic.js';
import type { DnsParseResponseJson as DnsParseResponseTraceJson } from '../command/handlers/dig/trace.js';
import type { OutputJson as HttpOutputJson } from '../command/http-command.js';
import type { PingParseOutputJson } from '../command/ping-command.js';
import { PROGRESS_INTERVAL_TIME } from '../constants.js';

type ProgressType = {
	rawOutput: string;
};

type ResultTypeJson = DnsParseResponseClassicJson | DnsParseResponseTraceJson | PingParseOutputJson | HttpOutputJson | Record<string, unknown>;

export class ProgressBuffer {
	private buffer: ProgressType[] = [];
	private timer?: NodeJS.Timeout;
	private isFirst = true;

	constructor (
		private readonly socket: Socket,
		private readonly testId: string,
		private readonly measurementId: string,
	) {}

	pushProgress (progress: ProgressType) {
		this.buffer.push(progress);

		if (this.isFirst) {
			this.sendProgress();
			this.isFirst = false;
		} else if (!this.timer) {
			this.timer = setTimeout(() => {
				this.sendProgress();
			}, PROGRESS_INTERVAL_TIME);
		}
	}

	pushResult (result: ResultTypeJson) {
		if (this.timer) {
			clearTimeout(this.timer);
		}

		this.sendResult(result);
	}

	private sendProgress () {
		delete this.timer;

		if (this.buffer.length === 0) {
			return;
		}

		this.socket.emit('probe:measurement:progress', {
			testId: this.testId,
			measurementId: this.measurementId,
			result: {
				rawOutput: this.buffer.map(({ rawOutput }) => rawOutput).join(''),
			},
		});

		this.buffer = [];
	}

	private sendResult (result: ResultTypeJson) {
		this.socket.emit('probe:measurement:result', {
			testId: this.testId,
			measurementId: this.measurementId,
			result,
		});
	}
}
