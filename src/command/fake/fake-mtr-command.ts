import type { Socket } from 'socket.io-client';
import type { CommandInterface } from '../../types';

export class FakeMtrCommand implements CommandInterface<object> {
	async run (socket: Socket, measurementId: string, testId: string): Promise<void> {
		setTimeout(() => {
			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				overwrite: true,
				result: {
					rawOutput: 'This is a fake mtr response for testing purposes\nHost          Loss% Drop Rcv Avg  StDev  Javg \n',
				},
			});
		}, 1000);

		setTimeout(() => {
			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				overwrite: true,
				result: {
					rawOutput: 'This is a fake mtr response for testing purposes\nHost                    Loss% Drop Rcv Avg  StDev  Javg \n1. AS??? _gateway (172.17.0.1)    0.0%    0   0 0.6    0.0   0.6\n2. AS??? 192.168.0.1 (192.168.0.1)    0.0%    0   0 5.5    0.0   5.5\n3. AS??? (waiting for reply) \n',
				},
			});
		}, 2000);

		setTimeout(() => {
			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				overwrite: true,
				result: {
					rawOutput: 'This is a fake mtr response for testing purposes\nHost                                                           Loss% Drop Rcv  Avg  StDev  Javg \n1. AS???   _gateway (172.17.0.1)                                0.0%    0   2  0.3    0.2   0.2\n2. AS???   192.168.0.1 (192.168.0.1)                            0.0%    0   1  5.1    0.4   0.7\n3. AS6830  84.116.254.17 (84.116.254.17)                        0.0%    0   1 15.0    0.0  15.0\n4. AS6830  pl-waw26b-rc1-ae-18-0.aorta.net (84.116.253.141)     0.0%    0   1 14.6    1.2   2.4\n5. AS6830  pl-waw26b-ri1-ae-24-0.aorta.net (84.116.138.73)      0.0%    0   1 14.4    0.5   0.9\n6. AS15169 72.14.203.234 (72.14.203.234)                        0.0%    0   1 15.5    0.2   0.4\n7. AS15169 142.250.227.13 (142.250.227.13)                      0.0%    0   1 14.0    0.3   0.6\n8. AS15169 209.85.253.225 (209.85.253.225)                      0.0%    0   1 14.0    0.2   0.3\n9. AS15169 waw07s06-in-f14.1e100.net (142.250.203.142)          0.0%    0   1 16.7    1.6   3.3\n',
				},
			});
		}, 3000);

		setTimeout(() => {
			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				overwrite: true,
				result: {
					rawOutput: 'This is a fake mtr response for testing purposes\nHost                                                           Loss% Drop Rcv  Avg  StDev  Javg \n1. AS???   _gateway (172.17.0.1)                                0.0%    0   2  0.3    0.2   0.2\n2. AS???   192.168.0.1 (192.168.0.1)                            0.0%    0   2  5.2    0.3   3.0\n3. AS6830  pl-waw26b-rt1.aorta.net (84.116.254.17)             33.3%    1   1 14.8    0.2   0.4\n4. AS6830  pl-waw26b-rc1-ae-18-0.aorta.net (84.116.253.141)     0.0%    0   2 14.6    1.0   8.5\n5. AS6830  pl-waw26b-ri1-ae-24-0.aorta.net (84.116.138.73)      0.0%    0   2 14.2    0.5   7.3\n6. AS15169 72.14.203.234 (72.14.203.234)                        0.0%    0   2 15.5    0.2   7.9\n7. AS15169 142.250.227.13 (142.250.227.13)                      0.0%    0   2 19.7    8.1  15.9\n8. AS15169 209.85.253.225 (209.85.253.225)                      0.0%    0   2 15.2    1.6   8.9\n9. AS15169 waw07s06-in-f14.1e100.net (142.250.203.142)          0.0%    0   2 16.3    1.4   9.5\n',
				},
			});
		}, 4000);

		setTimeout(() => {
			socket.emit('probe:measurement:result', {
				testId,
				measurementId,
				result: {
					status: 'finished',
					rawOutput: 'This is a fake mtr response for testing purposes\nHost                                                           Loss% Drop Rcv  Avg  StDev  Javg \n1. AS???   _gateway (172.17.0.1)                                0.0%    0   3  0.3    0.2   0.2\n2. AS???   192.168.0.1 (192.168.0.1)                            0.0%    0   3  5.2    0.3   3.0\n3. AS6830  pl-waw26b-rt1.aorta.net (84.116.254.17)             33.3%    1   2 14.8    0.2   0.4\n4. AS6830  pl-waw26b-rc1-ae-18-0.aorta.net (84.116.253.141)     0.0%    0   3 14.6    1.0   8.5\n5. AS6830  pl-waw26b-ri1-ae-24-0.aorta.net (84.116.138.73)      0.0%    0   3 14.2    0.5   7.3\n6. AS15169 72.14.203.234 (72.14.203.234)                        0.0%    0   3 15.5    0.2   7.9\n7. AS15169 142.250.227.13 (142.250.227.13)                      0.0%    0   3 19.7    8.1  15.9\n8. AS15169 209.85.253.225 (209.85.253.225)                      0.0%    0   3 15.2    1.6   8.9\n9. AS15169 waw07s06-in-f14.1e100.net (142.250.203.142)          0.0%    0   3 16.3    1.4   9.5\n',
					resolvedAddress: '142.250.203.142',
					resolvedHostname: 'waw07s06-in-f14.1e100.net',
					hops: [
						{
							stats: {
								min: 0.111,
								max: 0.578,
								avg: 0.3,
								total: 3,
								loss: 0,
								rcv: 3,
								drop: 0,
								stDev: 0.2,
								jMin: 0.1,
								jMax: 0.3,
								jAvg: 0.2,
							},
							asn: [],
							timings: [
								{
									rtt: 0.578,
								},
								{
									rtt: 0.233,
								},
								{
									rtt: 0.111,
								},
							],
							resolvedAddress: '172.17.0.1',
							resolvedHostname: '172.17.0.1',
						},
						{
							stats: {
								min: 4.765,
								max: 5.5,
								avg: 5.2,
								total: 3,
								loss: 0,
								rcv: 3,
								drop: 0,
								stDev: 0.3,
								jMin: 0.7,
								jMax: 5.3,
								jAvg: 3,
							},
							asn: [],
							timings: [
								{
									rtt: 5.5,
								},
								{
									rtt: 4.765,
								},
								{
									rtt: 5.306,
								},
							],
							resolvedAddress: '192.168.0.1',
							resolvedHostname: '192.168.0.1',
						},
						{
							stats: {
								min: 14.604,
								max: 14.957,
								avg: 14.8,
								total: 3,
								loss: 33.3,
								rcv: 2,
								drop: 1,
								stDev: 0.2,
								jMin: 0.4,
								jMax: 0.4,
								jAvg: 0.4,
							},
							asn: [
								6830,
							],
							timings: [
								{
									rtt: 14.957,
								},
								{
									rtt: null,
								},
								{
									rtt: 14.604,
								},
							],
							resolvedAddress: '84.116.254.17',
							resolvedHostname: 'pl-waw26b-rt1.aorta.net',
						},
						{
							stats: {
								min: 13.395,
								max: 15.817,
								avg: 14.6,
								total: 3,
								loss: 0,
								rcv: 3,
								drop: 0,
								stDev: 1,
								jMin: 2.4,
								jMax: 14.5,
								jAvg: 8.5,
							},
							asn: [
								6830,
							],
							timings: [
								{
									rtt: 13.395,
								},
								{
									rtt: 15.817,
								},
								{
									rtt: 14.491,
								},
							],
							resolvedAddress: '84.116.253.141',
							resolvedHostname: 'pl-waw26b-rc1-ae-18-0.aorta.net',
						},
						{
							stats: {
								min: 13.632,
								max: 14.878,
								avg: 14.2,
								total: 3,
								loss: 0,
								rcv: 3,
								drop: 0,
								stDev: 0.5,
								jMin: 0.9,
								jMax: 13.6,
								jAvg: 7.3,
							},
							asn: [
								6830,
							],
							timings: [
								{
									rtt: 13.955,
								},
								{
									rtt: 14.878,
								},
								{
									rtt: 13.632,
								},
							],
							resolvedAddress: '84.116.138.73',
							resolvedHostname: 'pl-waw26b-ri1-ae-24-0.aorta.net',
						},
						{
							stats: {
								min: 15.282,
								max: 15.718,
								avg: 15.5,
								total: 3,
								loss: 0,
								rcv: 3,
								drop: 0,
								stDev: 0.2,
								jMin: 0.4,
								jMax: 15.4,
								jAvg: 7.9,
							},
							asn: [
								15169,
							],
							timings: [
								{
									rtt: 15.718,
								},
								{
									rtt: 15.282,
								},
								{
									rtt: 15.383,
								},
							],
							resolvedAddress: '72.14.203.234',
							resolvedHostname: '72.14.203.234',
						},
						{
							stats: {
								min: 13.689,
								max: 31.233,
								avg: 19.7,
								total: 3,
								loss: 0,
								rcv: 3,
								drop: 0,
								stDev: 8.1,
								jMin: 0.6,
								jMax: 31.2,
								jAvg: 15.9,
							},
							asn: [
								15169,
							],
							timings: [
								{
									rtt: 14.259,
								},
								{
									rtt: 13.689,
								},
								{
									rtt: 31.233,
								},
							],
							resolvedAddress: '142.250.227.13',
							resolvedHostname: '142.250.227.13',
						},
						{
							stats: {
								min: 13.884,
								max: 17.525,
								avg: 15.2,
								total: 3,
								loss: 0,
								rcv: 3,
								drop: 0,
								stDev: 1.6,
								jMin: 0.3,
								jMax: 17.5,
								jAvg: 8.9,
							},
							asn: [
								15169,
							],
							timings: [
								{
									rtt: 14.189,
								},
								{
									rtt: 13.884,
								},
								{
									rtt: 17.525,
								},
							],
							resolvedAddress: '209.85.253.225',
							resolvedHostname: '209.85.253.225',
						},
						{
							stats: {
								min: 15.043,
								max: 18.311,
								avg: 16.3,
								total: 3,
								loss: 0,
								rcv: 3,
								drop: 0,
								stDev: 1.4,
								jMin: 3.3,
								jMax: 15.6,
								jAvg: 9.5,
							},
							asn: [
								15169,
							],
							timings: [
								{
									rtt: 15.043,
								},
								{
									rtt: 18.311,
								},
								{
									rtt: 15.645,
								},
							],
							resolvedAddress: '142.250.203.142',
							resolvedHostname: 'waw07s06-in-f14.1e100.net',
						},
					],
				},
			});
		}, 5000);
	}
}
