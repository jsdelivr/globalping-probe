import fs from 'node:fs';
import path from 'node:path';
import _ from 'lodash';

export default ({ snapshotResponses = false, updateExistingSnapshots = false }) => {
	if (updateExistingSnapshots) {
		snapshotResponses = true;
	}

	let snapshotFiles = new Map();
	let useTracker = new Map();
	let currentFile;

	function getFile () {
		if (!snapshotFiles.has(currentFile)) {
			useTracker.set(currentFile, new Map());

			try {
				snapshotFiles.set(currentFile, JSON.parse(fs.readFileSync(currentFile, 'utf8')));
			} catch {
				snapshotFiles.set(currentFile, {});
			}
		}

		return snapshotFiles.get(currentFile);
	}

	function getResponseBodyFromSnapshot (key, newBody) {
		let expectedResponses = getFile();
		markUsed(currentFile, key);

		if (newBody && snapshotResponses) {
			try {
				storeResponse(expectedResponses, key, newBody);
			} catch (e) {
				throw new Error('Failed to store the response.', { cause: e });
			}
		}

		lockKey(expectedResponses, key);

		if (!expectedResponses[key]) {
			return undefined;
		}

		return _.cloneDeep(expectedResponses[key]);
	}

	function getResponse (key) {
		let expectedResponses = getFile();
		markUsed(currentFile, key);

		return _.cloneDeep(expectedResponses[key]);
	}

	function isUsed (file, key) {
		return useTracker.get(file).get(key);
	}

	function lockKey (expectedResponses, key) {
		Object.defineProperty(expectedResponses, key, { writable: false });
	}

	function markUsed (file, key) {
		useTracker.get(file).set(key, true);
	}

	function storeFile (p, contents) {
		// Sort the object to minimize serialization diffs.
		let sortedContents = _.fromPairs(Object.keys(contents).sort((a, b) => {
			let aCount = a.split('/').length;
			let bCount = b.split('/').length;

			if (aCount === bCount) {
				return a < b ? -1 : b > a;
			}

			return aCount - bCount;
		}).map(key => [ key, contents[key] ]));

		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, JSON.stringify(sortedContents, null, '\t') + '\n');
	}

	function storeResponse (expectedResponses, key, data) {
		if (expectedResponses[key]) {
			if (!updateExistingSnapshots) {
				return;
			}

			if (_.isEqual(data, expectedResponses[key])) {
				return;
			}
		}

		expectedResponses[key] = _.cloneDeep(data);
	}

	return Object.assign((chai) => {
		chai.Assertion.addMethod('matchTestSnapshot', function (snapshotName, message) {
			let body = this._obj;
			let expected = getResponseBodyFromSnapshot(snapshotName, body);

			try {
				new chai.Assertion(body).to.deep.equal(expected, message);
			} catch (error) {
				error.stack += `\n\nUsing snapshot:\n    ${snapshotName}`;
				throw error;
			}
		});
	}, {
		prune () {
			for (let [ path, contents ] of snapshotFiles) {
				for (let key of Object.keys(contents)) {
					if (!isUsed(path, key)) {
						delete contents[key];
					}
				}

				storeFile(path, contents);
			}
		},
		setCurrentFile (file) {
			currentFile = file;
		},
		getSnapshot (snapshotName) {
			return getResponse(snapshotName);
		},
		snapshot (snapshotName, body) {
			getResponseBodyFromSnapshot(snapshotName, body);
		},
		store () {
			for (let [ path, contents ] of snapshotFiles) {
				storeFile(path, contents);
			}
		},
	});
};
