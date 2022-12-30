
import type {Socket} from 'socket.io-client';
import type {ProgressType as MtrProgressType, ResultTypeJson as MtrResultTypeJson} from '../command/handlers/mtr/types.js';
import {PROGRESS_INTERVAL_TIME} from '../constants.js';

type ProgressType = MtrProgressType;
type ResultTypeJson = MtrResultTypeJson;

export class ProgressBufferOverwrite {
	private buffer?: ProgressType;
	private timer?: NodeJS.Timeout;
	private isFirst = true;

	constructor(
		private readonly socket: Socket,
		private readonly testId: string,
		private readonly measurementId: string,
	) {}

	pushProgress(progress: ProgressType) {
		this.buffer = progress;

		if (this.isFirst) {
			this.sendProgress();
			this.isFirst = false;
		} else if (!this.timer) {
			this.timer = setTimeout(() => {
				this.sendProgress();
			}, PROGRESS_INTERVAL_TIME);
		}
	}

	pushResult(result: ResultTypeJson) {
		if (this.timer) {
			clearTimeout(this.timer);
		}

		this.sendResult(result);
	}

	private sendProgress() {
		delete this.timer;

		if (!this.buffer) {
			return;
		}

		this.socket.emit('probe:measurement:progress', {
			testId: this.testId,
			measurementId: this.measurementId,
			overwrite: true,
			result: this.buffer,
		});
		delete this.buffer;
	}

	private sendResult(result: ResultTypeJson) {
		this.socket.emit('probe:measurement:result', {
			testId: this.testId,
			measurementId: this.measurementId,
			result,
		});
	}
}
