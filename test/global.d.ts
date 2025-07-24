import type { chaiSnapshotPlugin } from './plugins/snapshot/index.js';

declare global {
	var chaiSnapshotInstance: chaiSnapshotPlugin;
	var currentTestTitle: string;
}

export {};
