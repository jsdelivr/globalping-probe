import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import { ProbeSettingsStore } from '../../../src/lib/probe-settings.js';
import type { ProbeSettings } from '../../../src/types.js';

describe('probe settings', () => {
	let directory: string;
	let settingsFile: string;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globalping-probe-settings-'));
		settingsFile = path.join(directory, '.PROBE-SETTINGS');
	});

	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it('should use defaults when the settings file does not exist', () => {
		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
	});

	it('should load settings from the settings file', () => {
		fs.writeFileSync(settingsFile, JSON.stringify({ meteredConnection: true }));

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: true });
	});

	it('should persist updated settings', () => {
		const store = new ProbeSettingsStore(settingsFile);

		store.update({ meteredConnection: true });

		expect(store.get()).to.deep.equal({ meteredConnection: true });
		expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))).to.deep.equal({ meteredConnection: true });
	});

	it('should not expose mutable settings', () => {
		const store = new ProbeSettingsStore(settingsFile);
		const settings = store.get() as ProbeSettings;

		settings.meteredConnection = true;

		expect(store.get()).to.deep.equal({ meteredConnection: false });
	});

	it('should not update in-memory settings when persistence fails', () => {
		const store = new ProbeSettingsStore(settingsFile);
		fs.mkdirSync(settingsFile);

		expect(() => store.update({ meteredConnection: true })).to.throw();
		expect(store.get()).to.deep.equal({ meteredConnection: false });
	});

	it('should remove invalid settings and use defaults', () => {
		fs.writeFileSync(settingsFile, '{');

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.false;
	});

	it('should use defaults when an unreadable settings file cannot be removed', () => {
		fs.mkdirSync(settingsFile);

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.true;
	});
});
