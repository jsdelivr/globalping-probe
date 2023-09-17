import type { Socket } from 'socket.io-client';
import type { CommandInterface } from '../../types';

export class FakePingCommand implements CommandInterface<object> {
	async run (socket: Socket, measurementId: string, testId: string): Promise<void> {
		setTimeout(() => {
			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {
					rawOutput: 'This is a ping response for testing purposes\nPING google.com (142.250.75.14): 56 data bytes\n' },
			});
		}, 1000);

		setTimeout(() => {
			socket.emit('probe:measurement:progress', {
				testId,
				measurementId,
				result: {
					rawOutput: '64 bytes from 142.250.75.14: icmp_seq=0 ttl=117 time=16.807 ms\n64 bytes from 142.250.75.14: icmp_seq=1 ttl=117 time=16.450 ms\n64 bytes from 142.250.75.14: icmp_seq=2 ttl=117 time=16.647 ms\n64 bytes from 142.250.75.14: icmp_seq=3 ttl=117 time=16.149 ms\n64 bytes from 142.250.75.14: icmp_seq=4 ttl=117 time=20.132 ms\n64 bytes from 142.250.75.14: icmp_seq=5 ttl=117 time=17.220 ms\n64 bytes from 142.250.75.14: icmp_seq=6 ttl=117 time=16.413 ms\n64 bytes from 142.250.75.14: icmp_seq=7 ttl=117 time=17.925 ms\n64 bytes from 142.250.75.14: icmp_seq=8 ttl=117 time=15.885 ms\n64 bytes from 142.250.75.14: icmp_seq=9 ttl=117 time=19.105 ms\n64 bytes from 142.250.75.14: icmp_seq=10 ttl=117 time=19.169 ms\n64 bytes from 142.250.75.14: icmp_seq=11 ttl=117 time=16.734 ms\n64 bytes from 142.250.75.14: icmp_seq=12 ttl=117 time=16.031 ms\n64 bytes from 142.250.75.14: icmp_seq=13 ttl=117 time=16.824 ms\n64 bytes from 142.250.75.14: icmp_seq=14 ttl=117 time=16.649 ms\n64 bytes from 142.250.75.14: icmp_seq=15 ttl=117 time=17.173 ms',
				},
			});
		}, 2000);

		setTimeout(() => {
			socket.emit('probe:measurement:result', {
				testId,
				measurementId,
				result: {
					rawOutput: 'This is a ping response for testing purposes\nPING google.com (142.250.75.14): 56 data bytes\n64 bytes from 142.250.75.14: icmp_seq=0 ttl=117 time=16.807 ms\n64 bytes from 142.250.75.14: icmp_seq=1 ttl=117 time=16.450 ms\n64 bytes from 142.250.75.14: icmp_seq=2 ttl=117 time=16.647 ms\n64 bytes from 142.250.75.14: icmp_seq=3 ttl=117 time=16.149 ms\n64 bytes from 142.250.75.14: icmp_seq=4 ttl=117 time=20.132 ms\n64 bytes from 142.250.75.14: icmp_seq=5 ttl=117 time=17.220 ms\n64 bytes from 142.250.75.14: icmp_seq=6 ttl=117 time=16.413 ms\n64 bytes from 142.250.75.14: icmp_seq=7 ttl=117 time=17.925 ms\n64 bytes from 142.250.75.14: icmp_seq=8 ttl=117 time=15.885 ms\n64 bytes from 142.250.75.14: icmp_seq=9 ttl=117 time=19.105 ms\n64 bytes from 142.250.75.14: icmp_seq=10 ttl=117 time=19.169 ms\n64 bytes from 142.250.75.14: icmp_seq=11 ttl=117 time=16.734 ms\n64 bytes from 142.250.75.14: icmp_seq=12 ttl=117 time=16.031 ms\n64 bytes from 142.250.75.14: icmp_seq=13 ttl=117 time=16.824 ms\n64 bytes from 142.250.75.14: icmp_seq=14 ttl=117 time=16.649 ms\n64 bytes from 142.250.75.14: icmp_seq=15 ttl=117 time=17.173 ms\n\n--- google.com ping statistics ---\n16 packets transmitted, 16 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 15.885/17.207/20.132/1.202 ms',
					resolvedAddress: '142.250.75.14',
					resolvedHostname: '142.250.75.14:',
					timings: [],
					stats: {
						min: 15.885,
						max: 20.132,
						avg: 17.207,
						loss: 0,
					},
				},
			});
		}, 3000);
	}
}
