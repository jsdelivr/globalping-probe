module.exports = {
	redis: {
		url: 'redis://localhost:6379',
		socket: {
			tls: false,
		},
	},
	db: {
		connection: {
			host: 'localhost',
			user: 'directus',
			password: 'password',
			database: 'directus-test',
			port: 3306,
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
