import _ from 'lodash';
import config from 'config';
import type { Socket } from 'socket.io-client';
import type { ResultTypeJson as MtrResultTypeJson } from '../command/handlers/mtr/types.js';
import type { DnsParseResponseJson as DnsParseResponseClassicJson } from '../command/handlers/dig/classic.js';
import type { DnsParseResponseJson as DnsParseResponseTraceJson } from '../command/handlers/dig/trace.js';
// import type { OutputJson as HttpOutputJson } from '../command/http-command.js';
import type { PingParseOutputJson } from '../command/ping-command.js';

type DefaultProgress = {
	rawOutput: string;
};

type HttpProgress = DefaultProgress & {
	rawHeaders?: string;
	rawBody: string;
};

type ProgressType = DefaultProgress | HttpProgress;

type ResultTypeJson = DnsParseResponseClassicJson | DnsParseResponseTraceJson | PingParseOutputJson | HttpOutputJson | MtrResultTypeJson | Record<string, unknown>;

const progressIntervalTime = config.get<number>('commands.progressInterval');

export class ProgressBuffer {
	private buffer: Record<string, string> = {};
	private offset: Record<string, number> = {};
	private isFirst = true;
	private timer?: NodeJS.Timeout;

	constructor (
		private readonly socket: Socket,
		private readonly testId: string,
		private readonly measurementId: string,
		private readonly mode: 'append' | 'diff' | 'overwrite',
	) {}

	pushProgress (progress: ProgressType) {
		Object.entries(progress).forEach(([ field, value ]) => {
			if (this.buffer[field] === undefined || this.mode !== 'append') {
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

		if (this.mode === 'diff') {
			Object.entries(this.buffer).forEach(([ field, value ]) => {
				const newOffset = value.length;
				this.buffer[field] = value.slice(this.offset[field] ?? 0);
				this.offset[field] = newOffset;
			});
		}

		this.socket.emit('probe:measurement:progress', {
			testId: this.testId,
			measurementId: this.measurementId,
			overwrite: this.mode === 'overwrite',
			result: this.buffer,
		});

		this.buffer = {};
	}

	private sendResult (result) {
		// console.log(JSON.stringify({
		// 	testId: this.testId,
		// 	measurementId: this.measurementId,
		// 	result,
		// }, null, 2));

		this.socket.emit('probe:measurement:result', {
			testId: this.testId,
			measurementId: this.measurementId,
			result,
		});
	}
}
