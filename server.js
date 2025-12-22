import https from 'node:https';
import fs from 'node:fs';

const server = https.createServer({
	key: fs.readFileSync('./key-file.pem'),
	cert: fs.readFileSync('./cert-file.pem'),
	ALPNProtocols: [ 'http/1.1' ],
}, (req, res) => {
	res.writeHead(200, {
		'content-type': 'text/plain',
		'x-custom': 'value',
	});

	res.end('Hello HTTP/1.1');
});

server.listen(8444, () => console.log('HTTP/1.1 server on https://localhost:8444'));

