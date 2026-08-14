import fs from 'node:fs';
import Joi from 'joi';
import type { ProbeSettings } from '../types.js';

const PROBE_SETTINGS_FILE = '/.PROBE-SETTINGS';
const DEFAULT_PROBE_SETTINGS: ProbeSettings = { meteredConnection: false };

const probeSettingsSchema = Joi.object<Partial<ProbeSettings>>({
	meteredConnection: Joi.boolean(),
}).unknown(false).required();

const removeInvalidSettingsFile = (file: string): void => {
	try {
		fs.rmSync(file, { force: true });
	} catch {}
};

type ProbeSettingsUpdateResult = { success: true } | { success: false; source: 'validation' | 'persistence'; error: unknown };

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

	public update (settings: Partial<ProbeSettings>): ProbeSettingsUpdateResult {
		const result = probeSettingsSchema.validate(settings, { convert: false });

		if (result.error) {
			return { success: false, source: 'validation', error: result.error };
		}

		const updatedSettings = { ...this.settings, ...result.value };
		this.settings = updatedSettings;

		try {
			fs.writeFileSync(this.file, JSON.stringify(updatedSettings), 'utf8');
		} catch (error: unknown) {
			return { success: false, source: 'persistence', error };
		}

		return { success: true };
	}
}

const probeSettingsStore = new ProbeSettingsStore();

export const getProbeSettings = (): Readonly<ProbeSettings> => probeSettingsStore.get();

export const updateProbeSettings = (settings: Partial<ProbeSettings>): ProbeSettingsUpdateResult => {
	return probeSettingsStore.update(settings);
};
