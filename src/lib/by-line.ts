import type { Readable } from 'node:stream';

export const byLine = (stream: Readable, fn: (line: string) => void) => {
	let buffer = '';

	stream.on('data', (chunk: Buffer) => {
		buffer += chunk.toString();

		const lines = buffer.match(/.*?\n|.+$|(?<=\n)$/g) ?? [];
		buffer = lines.pop() ?? '';

		for (const line of lines) {
			fn(line);
		}
	});

	stream.on('end', () => {
		if (buffer) {
			fn(buffer);
		}
	});
};
