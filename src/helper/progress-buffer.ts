import _ from 'lodash';
import config from 'config';
import type { Socket } from 'socket.io-client';
import type { ResultTypeJson as MtrResultTypeJson } from '../command/handlers/mtr/types.js';
import type { DnsParseResponseJson as DnsParseResponseClassicJson } from '../command/handlers/dig/classic.js';
import type { DnsParseResponseJson as DnsParseResponseTraceJson } from '../command/handlers/dig/trace.js';
import type { OutputJson as HttpOutputJson } from '../command/handlers/http/undici.js';
import type { PingParseOutputJson } from '../command/ping-command.js';

type DefaultProgress = {
	rawOutput: string;
};

type HttpProgress = DefaultProgress & {
	rawHeaders?: string;
	rawBody: string;
};

type ProgressData = DefaultProgress | HttpProgress;
type ProgressProducer = () => ProgressData | Promise<ProgressData>;

type ResultTypeJson = DnsParseResponseClassicJson | DnsParseResponseTraceJson | PingParseOutputJson | HttpOutputJson | MtrResultTypeJson | Record<string, unknown>;

const progressIntervalTime = config.get<number>('commands.progressInterval');

export class ProgressBuffer {
	private buffer: Record<string, string> = {};
	private offset: Record<string, number> = {};
	private isFirst = true;
	private timer?: NodeJS.Timeout;
	private progressProducer?: ProgressProducer;
	private resultSent = false;

	constructor (
		private readonly socket: Socket,
		private readonly testId: string,
		private readonly measurementId: string,
		private readonly mode: 'append' | 'diff' | 'overwrite',
	) {}

	pushProgress (progress: ProgressData) {
		this.mergeProgress(progress);
		this.scheduleSend();
	}

	pushLazyProgress (producer: ProgressProducer) {
		if (this.mode !== 'overwrite') {
			throw new Error('Delayed progress data parsing is only supported in overwrite mode.');
		}

		this.progressProducer = producer;
		this.scheduleSend();
	}

	private scheduleSend () {
		if (this.isFirst) {
			this.isFirst = false;
			void this.sendProgress();
		} else if (!this.timer) {
			this.timer = setTimeout(() => void this.sendProgress(), progressIntervalTime);
		}
	}

	pushResult (result: ResultTypeJson) {
		if (this.timer) {
			clearTimeout(this.timer);
		}

		this.resultSent = true;
		delete this.progressProducer;
		this.sendResult(result);
	}

	private mergeProgress (progress: ProgressData) {
		Object.entries(progress).forEach(([ field, value ]) => {
			if (this.buffer[field] === undefined || this.mode !== 'append') {
				this.buffer[field] = value;
			} else {
				this.buffer[field] += value;
			}
		});
	}

	private async sendProgress () {
		delete this.timer;

		if (this.progressProducer) {
			const producer = this.progressProducer;
			delete this.progressProducer;
			this.mergeProgress(await producer());
		}

		if (this.resultSent || _.isEmpty(this.buffer)) {
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

	private sendResult (result: ResultTypeJson) {
		this.socket.emit('probe:measurement:result', {
			testId: this.testId,
			measurementId: this.measurementId,
			result,
		});
	}
}
