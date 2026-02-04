import crypto from 'node:crypto';
import http from 'node:http';
import config from 'config';
import { scopedLogger } from './logger.js';

const serverLifetime = config.get<number>('adoptionServer.lifetime');
const serverPort = config.get<number>('adoptionServer.port');
const logger = scopedLogger('adoption-server');

let server: http.Server | undefined;
let closeTimeout: NodeJS.Timeout;
let token: string;

const ALLOWED_METHODS = [ 'GET', 'OPTIONS' ];

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': ALLOWED_METHODS,
	'Access-Control-Allow-Headers': 'Content-Type',
	'Cache-Control': 'no-cache, no-store, must-revalidate',
};

const IGNORED_HTTP_ERRORS = [ 'ECONNABORTED', 'ECONNRESET', 'EPIPE', 'HPE_INVALID_EOF_STATE' ];

export const stopLocalAdoptionServer = () => {
	server?.close();
	clearTimeout(closeTimeout);
};

export const startLocalAdoptionServer = () => {
	stopLocalAdoptionServer();

	// create a new token and start the server
	token = crypto.randomBytes(32).toString('hex');

	server = http.createServer((req, res) => {
		if (req.method === 'OPTIONS') {
			res.writeHead(204, CORS_HEADERS);
			res.end();
			return;
		}

		if (req.method !== 'GET') {
			res.writeHead(405, CORS_HEADERS);
			res.end();
			return;
		}

		if (req.url !== '/') {
			res.writeHead(404, CORS_HEADERS);
			res.end();
			return;
		}

		res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
		res.end(JSON.stringify({ token }));
	});

	server.on('error', (error: NodeJS.ErrnoException) => {
		if (error.code && IGNORED_HTTP_ERRORS.includes(error.code)) {
			return;
		}

		logger.error('Adoption server error:', error);
	});

	server.listen(serverPort);

	closeTimeout = setTimeout(() => {
		server?.close();
	}, serverLifetime);

	return {
		token,
		expiresAt: new Date(Date.now() + serverLifetime).toISOString(),
	};
};
