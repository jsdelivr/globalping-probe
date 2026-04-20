import { randomUUID } from 'node:crypto';
import { TTLCache } from '@isaacs/ttlcache';

const DISCONNECTS_TTL = 5 * 60 * 1000; // 5 mins
const MAX_DISCONNECTS_COUNT = 3;

export class DisconnectTest {
	private readonly disconnects = new TTLCache<string, number>({
		ttl: DISCONNECTS_TTL,
		dispose: () => {
			if (this.disconnects.size === 0) {
				this.updateStatus('too-many-disconnects', false);
			}
		},
	});

	constructor (private readonly updateStatus: (status: 'too-many-disconnects', value: boolean) => void) {}

	public reportDisconnect () {
		this.disconnects.set(randomUUID(), Date.now());

		if (this.disconnects.size >= MAX_DISCONNECTS_COUNT) {
			this.updateStatus('too-many-disconnects', true);
		}
	}
}

let disconnectTest: DisconnectTest;

export const initDisconnectTest = (updateStatus: (status: 'too-many-disconnects', value: boolean) => void) => {
	disconnectTest = new DisconnectTest(updateStatus);
	return disconnectTest;
};

export const getDisconnectTest = () => {
	if (!disconnectTest) {
		throw new Error('DisconnectTest is not initialized yet');
	}

	return disconnectTest;
};
