module.exports = {
	branches: [ 'master' ],
	plugins: [
		'@semantic-release/commit-analyzer',
		'@semantic-release/release-notes-generator',
		[ '@semantic-release/github', {
			assets: [
				{ 'path': 'globalping-probe.bundle.tar.gz', 'label': 'globalping-probe.bundle.tar.gz' }
			]
		} ],
		[ '@semantic-release/npm', {
			npmPublish: false
		} ],
		[ '@semantic-release/exec', {
			prepareCmd: 'tar -czf globalping-probe.bundle.tar.gz dist/ config/ node_modules/ package.json'
		} ],
		[ '@semantic-release/git', {
			assets: [ 'package.json', 'package-lock.json' ],
			message: 'chore(release): [skip ci] bump version to ${nextRelease.version}'
		} ]
	]
};
