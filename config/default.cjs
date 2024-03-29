module.exports = {
	api: {
		host: 'ws://api.globalping.io',
	},
	update: {
		releaseUrl: 'https://api.github.com/repos/jsdelivr/globalping-probe/releases/latest',
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
