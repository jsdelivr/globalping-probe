module.exports = {
	api: {
		host: 'ws://api.globalping.io',
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
		mtr: {
			interval: 0.5,
		},
	},
};
