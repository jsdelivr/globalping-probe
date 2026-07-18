const { DEFAULT_COMMIT_TYPES } = require('conventional-changelog-conventionalcommits');

module.exports = {
	branches: [ 'master' ],
	repositoryUrl: 'https://github.com/jsdelivr/globalping-probe.git',
	plugins: [
		[ '@semantic-release/commit-analyzer', {
			releaseRules: [
				{ type: 'misc', release: 'patch' },
			],
		}],
		[ '@semantic-release/release-notes-generator', {
			preset: 'conventionalcommits',
			presetConfig: {
				types: [
					...DEFAULT_COMMIT_TYPES,
					{ type: 'misc', section: 'Miscellaneous' },
				],
			},
		}],
		[ '@semantic-release/github', {
			assets: [
				{ path: 'globalping-probe.bundle.tar.gz', label: 'globalping-probe.bundle.tar.gz' },
			],
		}],
		[ '@semantic-release/npm', {
			npmPublish: false,
		}],
		[ '@semantic-release/exec', {
			prepareCmd: 'tar -czf globalping-probe.bundle.tar.gz bin/ dist/ config/ node_modules/ package.json',
		}],
		[ '@semantic-release/git', {
			assets: [ 'package.json', 'package-lock.json' ],
			message: 'chore(release): [skip ci] bump version to ${nextRelease.version}',
		}],
	],
};
