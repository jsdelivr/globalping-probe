declare global {
	namespace Chai {
		interface Assertion {
			matchTestSnapshot (snapshotName?: string, message?: string): Assertion;
		}
	}
}

interface SnapshotOptions {
	snapshotResponses?: boolean;
	updateExistingSnapshots?: boolean;
}

declare function chaiSnapshot (options: SnapshotOptions): chaiSnapshotPlugin;

export interface chaiSnapshotPlugin {
	(chai: any, utils: any): void;
	getSnapshot (snapshotName: string): any | undefined;
	prune (): void;
	setCurrentFile (file: string): void;
	snapshot (snapshotName: string, body: any): void;
	store (): void;
}

export = chaiSnapshot;
