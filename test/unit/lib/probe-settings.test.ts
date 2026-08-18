import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { ProbeSettingsStore } from '../../../src/lib/probe-settings.js';
import type { ProbeSettings } from '../../../src/types.js';

describe('probe settings', () => {
	let directory: string;
	let settingsFile: string;
	let sandbox: sinon.SinonSandbox;

	beforeEach(() => {
		sandbox = sinon.createSandbox();
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globalping-probe-settings-'));
		settingsFile = path.join(directory, '.PROBE-SETTINGS');
	});

	afterEach(() => {
		sandbox.restore();
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

	it('should remove settings with invalid values and use defaults', () => {
		fs.writeFileSync(settingsFile, JSON.stringify({ meteredConnection: 'true' }));

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.false;
	});

	it('should remove settings with unknown properties and use defaults', () => {
		fs.writeFileSync(settingsFile, JSON.stringify({ unknown: true }));

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.false;
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

	it('should update in-memory settings when persistence fails', () => {
		const store = new ProbeSettingsStore(settingsFile);
		fs.mkdirSync(settingsFile);

		store.update({ meteredConnection: true });

		expect(store.get()).to.deep.equal({ meteredConnection: true });
	});

	it('should reject updates with invalid values', () => {
		const store = new ProbeSettingsStore(settingsFile);

		store.update({ meteredConnection: 'true' } as unknown as Partial<ProbeSettings>);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.false;
	});

	it('should reject updates with unknown properties', () => {
		const store = new ProbeSettingsStore(settingsFile);

		store.update({ unknown: true } as unknown as Partial<ProbeSettings>);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.false;
	});

	it('should remove invalid settings and use defaults', () => {
		fs.writeFileSync(settingsFile, '{');

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.false;
	});

	it('should preserve the settings path when it cannot be read', () => {
		fs.mkdirSync(settingsFile);

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.true;
	});

	it('should preserve a valid file after a filesystem read failure', () => {
		fs.writeFileSync(settingsFile, JSON.stringify({ meteredConnection: true }));
		const readError = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
		const rmStub = sandbox.spy(fs, 'rmSync');
		sandbox.stub(fs, 'readFileSync').throws(readError);

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(rmStub.notCalled).to.be.true;
		expect(fs.existsSync(settingsFile)).to.be.true;
	});
});
