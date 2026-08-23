import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { Socket } from 'socket.io-client';
import { ProbeSettingsStore, updateProbeSettings } from '../../../src/lib/probe-settings.js';
import type { ProbeSettings } from '../../../src/types.js';

describe('probe settings', () => {
	let directory: string;
	let settingsFile: string;
	let sandbox: sinon.SinonSandbox;
	let socket: sinon.SinonStubbedInstance<Socket>;

	beforeEach(() => {
		sandbox = sinon.createSandbox();
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globalping-probe-settings-'));
		settingsFile = path.join(directory, '.PROBE-SETTINGS');
		socket = sandbox.createStubInstance(Socket) as sinon.SinonStubbedInstance<Socket>;
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

	it('should preserve unknown settings from the settings file', () => {
		fs.writeFileSync(settingsFile, JSON.stringify({ meteredConnection: true, unknown: true }));

		const store = new ProbeSettingsStore(settingsFile);

		expect(store.get()).to.deep.equal({ meteredConnection: true, unknown: true });
		expect(fs.existsSync(settingsFile)).to.be.true;
	});

	it('should persist only changed settings', async () => {
		const store = new ProbeSettingsStore(settingsFile);
		const writeFileSpy = sandbox.spy(fs.promises, 'writeFile');

		const firstSuccess = await store.update({ meteredConnection: true });
		const secondSuccess = await store.update({ meteredConnection: true });

		expect(firstSuccess).to.be.true;
		expect(secondSuccess).to.be.true;
		expect(writeFileSpy.calledOnce).to.be.true;
		expect(store.get()).to.deep.equal({ meteredConnection: true });
		expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))).to.deep.equal({ meteredConnection: true });
	});

	it('should serialize consecutive settings writes', async () => {
		const store = new ProbeSettingsStore(settingsFile);
		const firstWrite = sinon.promise<void>();
		const writeFileStub = sandbox.stub(fs.promises, 'writeFile');
		writeFileStub.onFirstCall().returns(firstWrite);
		writeFileStub.onSecondCall().returns(Promise.resolve());

		const firstUpdate = store.update({ meteredConnection: true });
		const secondUpdate = store.update({ meteredConnection: false });
		await Promise.resolve();

		expect(writeFileStub.calledOnce).to.be.true;
		expect(writeFileStub.firstCall.args).to.deep.equal([ settingsFile, JSON.stringify({ meteredConnection: true }, null, '\t'), 'utf8' ]);

		firstWrite.resolve(undefined);
		const results = await Promise.all([ firstUpdate, secondUpdate ]);

		expect(results).to.deep.equal([ true, true ]);
		expect(writeFileStub.calledTwice).to.be.true;
		expect(writeFileStub.secondCall.args).to.deep.equal([ settingsFile, JSON.stringify({ meteredConnection: false }, null, '\t'), 'utf8' ]);
	});

	it('should acknowledge only updated probe settings', async () => {
		sandbox.stub(fs.promises, 'writeFile').resolves();
		const settings = { meteredConnection: true };
		const invalidSettings = { meteredConnection: 'true' } as unknown as Partial<ProbeSettings>;

		await updateProbeSettings(socket)(settings);
		await updateProbeSettings(socket)(invalidSettings);

		expect(socket.emit.calledOnceWithExactly('probe:settings:update', settings)).to.be.true;
	});

	it('should acknowledge probe settings in update order', async () => {
		const firstSettings = { meteredConnection: true };
		const secondSettings = { meteredConnection: false };
		const firstWrite = sinon.promise<void>();
		const secondWrite = sinon.promise<void>();
		const writeFileStub = sandbox.stub(fs.promises, 'writeFile');
		writeFileStub.onFirstCall().returns(firstWrite);
		writeFileStub.onSecondCall().returns(secondWrite);
		const handler = updateProbeSettings(socket);

		const firstUpdate = handler(firstSettings);
		const secondUpdate = handler(secondSettings);
		await Promise.resolve();

		expect(socket.emit.notCalled).to.be.true;

		firstWrite.resolve(undefined);
		await firstUpdate;

		expect(socket.emit.calledOnceWithExactly('probe:settings:update', firstSettings)).to.be.true;

		secondWrite.resolve(undefined);
		await secondUpdate;

		expect(socket.emit.args).to.deep.equal([
			[ 'probe:settings:update', firstSettings ],
			[ 'probe:settings:update', secondSettings ],
		]);
	});

	it('should not expose mutable settings', () => {
		const store = new ProbeSettingsStore(settingsFile);
		const settings = store.get() as ProbeSettings;

		settings.meteredConnection = true;

		expect(store.get()).to.deep.equal({ meteredConnection: false });
	});

	it('should update in-memory settings when persistence fails', async () => {
		const store = new ProbeSettingsStore(settingsFile);
		fs.mkdirSync(settingsFile);

		const success = await store.update({ meteredConnection: true });

		expect(success).to.be.true;
		expect(store.get()).to.deep.equal({ meteredConnection: true });
	});

	it('should reject updates with invalid values', async () => {
		const store = new ProbeSettingsStore(settingsFile);

		const success = await store.update({ meteredConnection: 'true' } as unknown as Partial<ProbeSettings>);

		expect(success).to.be.false;
		expect(store.get()).to.deep.equal({ meteredConnection: false });
		expect(fs.existsSync(settingsFile)).to.be.false;
	});

	it('should accept and persist updates with unknown properties', async () => {
		const store = new ProbeSettingsStore(settingsFile);

		const success = await store.update({ unknown: true } as unknown as Partial<ProbeSettings>);

		expect(success).to.be.true;
		expect(store.get()).to.deep.equal({ meteredConnection: false, unknown: true });
		expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))).to.deep.equal({ meteredConnection: false, unknown: true });
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
