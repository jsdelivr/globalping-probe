import fs from 'node:fs';
import Joi from 'joi';
import type { ProbeSettings } from '../types.js';
import { scopedLogger } from './logger.js';

const PROBE_SETTINGS_FILE = '/.PROBE-SETTINGS';
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

	public update (settings: Partial<ProbeSettings>): void {
		const result = probeSettingsSchema.validate(settings, { convert: false });

		if (result.error) {
			logger.error('Invalid probe settings received:', result.error);
			return;
		}

		const updatedSettings = { ...this.settings, ...result.value };
		this.settings = updatedSettings;

		try {
			fs.writeFileSync(this.file, JSON.stringify(updatedSettings), 'utf8');
		} catch (error: unknown) {
			logger.error('Probe settings updated in memory, but failed to persist them:', { settings: this.get(), error });
			return;
		}

		logger.info('Probe settings updated.', { settings: this.get() });
	}
}

const probeSettingsStore = new ProbeSettingsStore();

export const getProbeSettings = (): Readonly<ProbeSettings> => probeSettingsStore.get();

export const updateProbeSettings = (settings: Partial<ProbeSettings>): void => {
	return probeSettingsStore.update(settings);
};
