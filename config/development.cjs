module.exports = {
	api: {
		host: 'ws://localhost:80',
		httpHost: 'http://localhost:80/v1',
	},
	update: {
		interval: 10,
		maxDeviation: 5,
	},
	commands: {
		mtr: {
			interval: 1,
		},
	},
};
