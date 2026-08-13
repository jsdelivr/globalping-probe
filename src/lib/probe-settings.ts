import fs from 'node:fs';
import type { ProbeSettings } from '../types.js';

const PROBE_SETTINGS_FILE = '/.PROBE-SETTINGS';
const DEFAULT_PROBE_SETTINGS: ProbeSettings = { meteredConnection: false };

export class ProbeSettingsStore {
	private settings: ProbeSettings;

	constructor (private readonly file = PROBE_SETTINGS_FILE) {
		try {
			const settings = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ProbeSettings>;
			this.settings = { ...DEFAULT_PROBE_SETTINGS, ...settings };
		} catch {
			try {
				fs.rmSync(this.file, { force: true });
			} catch {}

			this.settings = { ...DEFAULT_PROBE_SETTINGS };
		}
	}

	public get (): Readonly<ProbeSettings> {
		return { ...this.settings };
	}

	public update (settings: Partial<ProbeSettings>): void {
		const updatedSettings = { ...this.settings, ...settings };
		fs.writeFileSync(this.file, JSON.stringify(updatedSettings), 'utf8');
		this.settings = updatedSettings;
	}
}

const probeSettingsStore = new ProbeSettingsStore();

export const getProbeSettings = (): Readonly<ProbeSettings> => probeSettingsStore.get();

export const updateProbeSettings = (settings: Partial<ProbeSettings>): void => {
	probeSettingsStore.update(settings);
};
