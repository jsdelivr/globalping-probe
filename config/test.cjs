module.exports = {
	redis: {
		url: 'redis://localhost:6379',
		socket: {
			tls: false,
		},
	},
	db: {
		type: 'mysql',
		connection: {
			host: 'localhost',
			user: 'directus',
			password: 'password',
			database: 'directus-test',
			port: 3306,
			multipleStatements: true,
		},
	},
};
