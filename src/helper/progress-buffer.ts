import _ from 'lodash';
import config from 'config';
import type { Socket } from 'socket.io-client';
import type { DnsParseResponseJson as DnsParseResponseClassicJson } from '../command/handlers/dig/classic.js';
import type { DnsParseResponseJson as DnsParseResponseTraceJson } from '../command/handlers/dig/trace.js';
import type { OutputJson as HttpOutputJson } from '../command/http-command.js';
import type { PingParseOutputJson } from '../command/ping-command.js';

type DefaultProgress = {
	rawOutput: string;
};

type HttpProgress = DefaultProgress & {
	rawHeaders?: string;
	rawBody: string;
};

type ProgressType = DefaultProgress | HttpProgress;

type ResultTypeJson = DnsParseResponseClassicJson | DnsParseResponseTraceJson | PingParseOutputJson | HttpOutputJson | Record<string, unknown>;

const progressIntervalTime = config.get<number>('commands.progressInterval');

export class ProgressBuffer {
	private buffer: Record<string, string> = {};
	private timer?: NodeJS.Timeout;
	private isFirst = true;

	constructor (
		private readonly socket: Socket,
		private readonly testId: string,
		private readonly measurementId: string,
	) {}

	pushProgress (progress: ProgressType) {
		Object.entries(progress).forEach(([ field, value ]) => {
			if (this.buffer[field] === undefined) {
				this.buffer[field] = value;
			} else {
				this.buffer[field] += value;
			}
		});

		if (this.isFirst) {
			this.sendProgress();
			this.isFirst = false;
		} else if (!this.timer) {
			this.timer = setTimeout(() => {
				this.sendProgress();
			}, progressIntervalTime);
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

		if (_.isEmpty(this.buffer)) {
			return;
		}

		this.socket.emit('probe:measurement:progress', {
			testId: this.testId,
			measurementId: this.measurementId,
			result: this.buffer,
		});

		this.buffer = {};
	}

	private sendResult (result: ResultTypeJson) {
		this.socket.emit('probe:measurement:result', {
			testId: this.testId,
			measurementId: this.measurementId,
			result,
		});
	}
}
