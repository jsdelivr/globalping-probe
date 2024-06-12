module.exports = {
	redis: {
		url: 'redis://localhost:16379',
		socket: {
			tls: false,
		},
	},
	db: {
		connection: {
			host: 'localhost',
			user: 'directus',
			password: 'password',
			database: 'dashboard-globalping-test',
			port: 13306,
			multipleStatements: true,
		},
	},
	admin: {
		key: 'admin',
	},
	systemApi: {
		key: 'system',
	},
};
