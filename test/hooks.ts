import * as chai from 'chai';
import nock from 'nock';

import chaiSnapshot from './plugins/snapshot/index.js';

global.chaiSnapshotInstance = chaiSnapshot({
	snapshotResponses: !!Number(process.env['SNAPSHOT_RESPONSES']),
	updateExistingSnapshots: !!Number(process.env['UPDATE_EXISTING_SNAPSHOTS']),
});

chai.use(global.chaiSnapshotInstance);

export const mochaHooks = {
	async beforeAll () {
		if (global.v8debug === undefined && !/--debug|--inspect/.test(process.execArgv.join(' ')) && !process.env['JB_IDE_PORT']) {
			import('blocked').then(({ default: blocked }) => {
				blocked((ms) => {
					throw new Error(`Blocked for ${ms} ms.`);
				}, { threshold: 100 });
			}).catch(console.error);
		}

		nock.disableNetConnect();
		nock.enableNetConnect('127.0.0.1');
	},
	afterAll () {
		if (Number(process.env['PRUNE_OLD_SNAPSHOTS'])) {
			global.chaiSnapshotInstance.prune();
		} else if (Number(process.env['SNAPSHOT_RESPONSES']) || Number(process.env['UPDATE_EXISTING_SNAPSHOTS'])) {
			global.chaiSnapshotInstance.store();
		}
	},
};
