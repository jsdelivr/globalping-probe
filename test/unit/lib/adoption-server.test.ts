import { expect } from 'chai';
import * as sinon from 'sinon';
import config from 'config';
import nock from 'nock';
import got from 'got';
import { startLocalAdoptionServer, stopLocalAdoptionServer } from '../../../src/lib/adoption-server.js';
import { useSandboxWithFakeTimers } from '../../utils.js';

describe('adoption-server', () => {
	let sandbox: sinon.SinonSandbox;
	const port = config.get<number>('adoptionServer.port');
	const baseUrl = `http://127.0.0.1:${port}`;

	beforeEach(() => {
		sandbox = useSandboxWithFakeTimers();
		nock.enableNetConnect(host => host.includes('127.0.0.1'));
	});

	afterEach(async () => {
		await stopLocalAdoptionServer();
		sandbox.restore();
	});

	describe('startLocalAdoptionServer', () => {
		it('should start the server and return token and expiration', async () => {
			const { token, expiresAt } = await startLocalAdoptionServer();

			expect(token).to.be.a('string').and.not.empty;
			expect(expiresAt).to.be.a('string');
			expect(new Date(expiresAt).getTime()).to.be.greaterThan(Date.now());

			const response = await got(baseUrl, { responseType: 'json' });
			expect(response.body).to.deep.equal({ token });
		});

		it('should return 200 and the token for GET requests to root', async () => {
			const { token } = await startLocalAdoptionServer();
			const response = await got(baseUrl, { responseType: 'json' });

			expect(response.statusCode).to.equal(200);

			expect(response.headers).to.include({
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-cache, no-store, must-revalidate',
				'access-control-allow-origin': '*',
			});

			expect(response.body).to.deep.equal({ token });
		});

		it('should return 204 for OPTIONS requests', async () => {
			await startLocalAdoptionServer();
			const response = await got(baseUrl, { method: 'OPTIONS' });

			expect(response.statusCode).to.equal(204);

			expect(response.headers).to.include({
				'access-control-allow-methods': 'GET, OPTIONS',
				'access-control-allow-origin': '*',
			});

			expect(response.body).to.be.empty;
		});

		it('should redirect with token on /adopt', async () => {
			const { token } = await startLocalAdoptionServer();
			const dashboardUrl = config.get<string>('dashboard.url');

			const response = await got(`${baseUrl}/adopt`, { followRedirect: false });

			expect(response.statusCode).to.equal(307);

			expect(response.headers).to.include({
				'location': `${dashboardUrl}?adopt=${token}`,
				'cache-control': 'no-cache, no-store, must-revalidate',
				'access-control-allow-origin': '*',
			});

			expect(response.body).to.be.empty;
		});

		it('should return 405 for non-GET/OPTIONS requests', async () => {
			await startLocalAdoptionServer();

			try {
				await got(baseUrl, { method: 'POST' });
				expect.fail('Should have thrown HTTPError');
			} catch (error) {
				expect(error.response.statusCode).to.equal(405);

				expect(error.response.headers).to.include({
					'access-control-allow-origin': '*',
				});
			}
		});

		it('should return 404 for unknown paths', async () => {
			await startLocalAdoptionServer();

			try {
				await got(`${baseUrl}/unknown`);
				expect.fail('Should have thrown HTTPError');
			} catch (error) {
				expect(error.response.statusCode).to.equal(404);
			}
		});

		it('should close the server automatically after lifetime', async () => {
			await startLocalAdoptionServer();

			const lifetime = config.get<number>('adoptionServer.lifetime');
			await sandbox.clock.tickAsync(lifetime + 100);

			try {
				await got(baseUrl, { timeout: { connect: 300 }, retry: { limit: 0 } });
				expect.fail('Server should be closed');
			} catch (error) {
				expect(error.code).to.match(/ECONNREFUSED|ETIMEDOUT/);
			}
		});
	});

	describe('stopLocalAdoptionServer', () => {
		it('should stop the server manually', async () => {
			await startLocalAdoptionServer();
			await stopLocalAdoptionServer();

			try {
				await got(baseUrl, { timeout: { connect: 300 }, retry: { limit: 0 } });
				expect.fail('Server should be closed');
			} catch (error) {
				expect(error.code).to.match(/ECONNREFUSED|ETIMEDOUT/);
			}
		});

		it('should handle calling stop multiple times gracefully', async () => {
			await startLocalAdoptionServer();
			await stopLocalAdoptionServer();
			await stopLocalAdoptionServer();
		});
	});
});
