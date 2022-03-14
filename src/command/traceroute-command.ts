import type {CommandInterface} from '../types.js';

type TracerouteOptions = {
	target: string;
	packets?: number;
	quick?: boolean;
};

export class TracerouteCommand implements CommandInterface<TracerouteOptions> {
	async run(): Promise<void> {
		throw new Error('not implemented');
	}
}
