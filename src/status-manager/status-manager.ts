import type { ExecaChildProcess } from 'execa';
import type { Socket } from 'socket.io-client';
import type { PingCommandOptions, PingOptions } from '../command/ping-command.js';
import { hasRequired } from '../lib/dependencies.js';
import { initDisconnectTest } from './disconnect-test.js';
import { initIcmpTcpTest } from './icmp-tcp-test.js';
import { initPingTest } from './ping-test.js';

export class StatusManager {
	private statuses: {
		'unbuffer-missing': boolean;
		'ping-test-failed': boolean | null;
		'icmp-tcp-test-failed': boolean | null;
		'too-many-disconnects': boolean;
		'sigterm': boolean;
	} = {
			'unbuffer-missing': false,
			'ping-test-failed': null,
			'icmp-tcp-test-failed': null,
			'too-many-disconnects': false,
			'sigterm': false,
		};

	private readonly pingTest;
	private readonly icmpTcpTest;

	constructor (
		private readonly socket: Socket,
		pingCmd: (options: PingOptions, commandOptions?: PingCommandOptions) => ExecaChildProcess,
	) {
		const statusPingCmd = (options: PingOptions) => pingCmd(options, { interval: 1 });
		this.pingTest = initPingTest(this.updateStatus.bind(this), socket, statusPingCmd);
		this.icmpTcpTest = initIcmpTcpTest(this.updateStatus.bind(this), socket, statusPingCmd);
		initDisconnectTest(this.updateStatus.bind(this));
	}

	public async start () {
		const hasRequiredDeps = await hasRequired();

		if (!hasRequiredDeps) {
			this.updateStatus('unbuffer-missing', true);
			return;
		} else if (this.statuses['unbuffer-missing']) {
			this.updateStatus('unbuffer-missing', false);
		}

		await this.pingTest.start();
		await this.icmpTcpTest.start();
	}

	public stop () {
		this.updateStatus('sigterm', true);
		this.pingTest.stop();
		this.icmpTcpTest.stop();
	}

	public getStatus () {
		if (this.statuses.sigterm) {
			return 'sigterm';
		}

		if (this.statuses['unbuffer-missing']) {
			return 'unbuffer-missing';
		}

		if (this.statuses['ping-test-failed'] === null) {
			return 'initializing';
		}

		if (this.statuses['ping-test-failed']) {
			return 'ping-test-failed';
		}

		if (this.statuses['icmp-tcp-test-failed'] === null) {
			return 'initializing';
		}

		if (this.statuses['icmp-tcp-test-failed']) {
			return 'icmp-tcp-test-failed';
		}

		if (this.statuses['too-many-disconnects']) {
			return 'too-many-disconnects';
		}

		return 'ready';
	}

	public updateStatus (status: keyof StatusManager['statuses'], value: boolean) {
		if (this.statuses[status] === value) {
			return;
		}

		this.statuses[status] = value;
		this.sendStatus();
	}

	public sendStatus () {
		this.socket.emit('probe:status:update', this.getStatus());
	}
}

let statusManager: StatusManager;

export const initStatusManager = (socket: Socket, pingCmd: (options: PingOptions, commandOptions?: PingCommandOptions) => ExecaChildProcess) => {
	statusManager = new StatusManager(socket, pingCmd);
	return statusManager;
};

export const getStatusManager = () => {
	if (!statusManager) {
		throw new Error('StatusManager is not initialized yet');
	}

	return statusManager;
};
