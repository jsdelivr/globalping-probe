import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { promisify } from 'node:util';
import config from 'config';
import { scopedLogger } from './logger.js';

const serverLifetime = config.get<number>('adoptionServer.lifetime');
const serverPort = config.get<number>('adoptionServer.port');
const logger = scopedLogger('adoption-server');
const dashboardUrl = config.get<string>('dashboard.url');

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

const ALLOWED_PATHS = [ '/', '/adopt' ];

export const stopLocalAdoptionServer = async () => {
	clearTimeout(closeTimeout);

	const activeServer = server;
	server = undefined;

	if (!activeServer) {
		return;
	}

	await promisify(activeServer.close.bind(activeServer))();
};

export const startLocalAdoptionServer = async () => {
	await stopLocalAdoptionServer();

	// create a new token and start the server
	token = crypto.randomBytes(32).toString('hex');

	const localServer = http.createServer((req, res) => {
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

		if (!req.url) {
			res.writeHead(400, CORS_HEADERS);
			res.end();
			return;
		}

		const path = new URL(req.url, 'http://localhost').pathname;

		if (!ALLOWED_PATHS.includes(path)) {
			res.writeHead(404, CORS_HEADERS);
			res.end();
			return;
		}

		if (path === '/adopt') {
			res.writeHead(307, {
				...CORS_HEADERS,
				Location: `${dashboardUrl}?adopt=${token}`,
			});

			res.end();
			return;
		}

		res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
		res.end(JSON.stringify({ token }));
	});

	localServer.on('error', (error: NodeJS.ErrnoException) => {
		if (error.code && IGNORED_HTTP_ERRORS.includes(error.code)) {
			return;
		}

		logger.error('Adoption server error:', error);
	});

	const listeningPromise = once(localServer, 'listening');
	localServer.listen(serverPort);
	await listeningPromise;

	server = localServer;

	closeTimeout = setTimeout(() => {
		void stopLocalAdoptionServer().catch((error: unknown) => {
			logger.error('Failed to stop adoption server:', error);
		});
	}, serverLifetime);

	return {
		token,
		expiresAt: new Date(Date.now() + serverLifetime).toISOString(),
	};
};
