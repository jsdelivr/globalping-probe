module.exports = {
	api: {
		host: 'ws://localhost:3000',
		httpHost: 'http://localhost:3000/v1',
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
