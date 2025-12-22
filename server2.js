import http2 from 'node:http2';
import fs from 'node:fs';

const server = http2.createSecureServer({
	key: fs.readFileSync('./key-file.pem'),
	cert: fs.readFileSync('./cert-file.pem'),
	allowHTTP1: false,
	ALPNProtocols: [ 'h2' ],
});

server.on('stream', (stream) => {
	stream.on('error', (err) => {
		console.error('Stream error:', err.code);
	});

	if (stream.destroyed || stream.closed) {
		return;
	}

	try {
		stream.respond({
			':status': 200,
			'content-type': 'text/plain',
			'x-custom': 'value',
		});

		stream.end('Hello HTTP/2');
	} catch (err) {
		if (err.code !== 'ERR_STREAM_WRITE_AFTER_END') {
			console.error('Unexpected error:', err);
		}
	}
});

server.listen(8444, () => console.log('HTTP/2 server on https://localhost:8444'));

