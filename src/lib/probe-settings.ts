import fs from 'node:fs';
import cluster from 'node:cluster';
import os from 'node:os';
import path from 'node:path';
import Joi from 'joi';
import type { Socket } from 'socket.io-client';
import type { ProbeSettings } from '../types.js';
import { scopedLogger } from './logger.js';

const PROBE_SETTINGS_FILE = process.env['NODE_ENV'] === 'development'
	? path.join(os.tmpdir(), `.globalping-probe-${cluster.worker?.id ?? 'primary'}.json`)
	: '/.globalping-probe.json';

const DEFAULT_PROBE_SETTINGS: ProbeSettings = { meteredConnection: false };
const logger = scopedLogger('probe-settings');

const probeSettingsSchema = Joi.object<Partial<ProbeSettings>>({
	meteredConnection: Joi.boolean(),
}).unknown(false).required();

const removeInvalidSettingsFile = (file: string): void => {
	try {
		fs.rmSync(file, { force: true });
	} catch {}
};

export class ProbeSettingsStore {
	private settings: ProbeSettings;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor (private readonly file = PROBE_SETTINGS_FILE) {
		this.settings = { ...DEFAULT_PROBE_SETTINGS };
		let rawSettings: string;

		try {
			rawSettings = fs.readFileSync(this.file, 'utf8');
		} catch {
			return;
		}

		let parsedSettings: unknown;

		try {
			parsedSettings = JSON.parse(rawSettings) as unknown;
		} catch {
			removeInvalidSettingsFile(this.file);
			return;
		}

		const result = probeSettingsSchema.validate(parsedSettings, { convert: false });

		if (result.error) {
			removeInvalidSettingsFile(this.file);
			return;
		}

		this.settings = { ...DEFAULT_PROBE_SETTINGS, ...result.value };
	}

	public get (): Readonly<ProbeSettings> {
		return { ...this.settings };
	}

	public async update (settings: Partial<ProbeSettings>): Promise<boolean> {
		const result = probeSettingsSchema.validate(settings, { convert: false });

		if (result.error) {
			logger.error('Invalid probe settings received:', result.error);
			return false;
		}

		const updatedSettings = { ...this.settings, ...result.value };
		this.settings = updatedSettings;

		this.writeQueue = this.writeQueue
			.then(() => fs.promises.writeFile(this.file, JSON.stringify(updatedSettings, null, '\t'), 'utf8'))
			.then(
				() => {
					logger.info('Probe settings updated.', { settings: updatedSettings });
				},
				(error: unknown) => {
					logger.error('Probe settings updated in memory, but failed to save:', { settings: updatedSettings, error });
				},
			);

		await this.writeQueue;
		return true;
	}
}

const probeSettingsStore = new ProbeSettingsStore();

export const getProbeSettings = (): Readonly<ProbeSettings> => probeSettingsStore.get();

export const updateProbeSettings = (socket: Socket) => async (settings: Partial<ProbeSettings>): Promise<void> => {
	const success = await probeSettingsStore.update(settings);

	if (success) {
		socket.emit('probe:settings:update', settings);
	}
};
