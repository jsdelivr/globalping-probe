module.exports = {
	api: {
		host: 'wss://api.globalping.io',
		httpHost: 'https://api.globalping.io/v1',
	},
	update: {
		releaseUrl: 'https://data.jsdelivr.com/v1/packages/gh/jsdelivr/globalping-probe/resolved',
		interval: 300,
		maxDeviation: 300,
	},
	status: {
		numberOfPackets: 6,
	},
	stats: {
		interval: 10,
	},
	uptime: {
		interval: 300,
		maxDeviation: 86400,
		maxUptime: 604800,
	},
	commands: {
		timeout: 25,
		mtr: {
			interval: 0.5,
		},
	},
};
