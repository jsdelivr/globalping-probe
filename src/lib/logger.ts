/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import process from 'node:process';
import { inspect } from 'node:util';
import * as winston from 'winston';

const objectFormatter = (object: Record<string, any>) => {
	const entries = Object.entries(object).map(([ key, value ]) => {
		if (key === 'timings' && value && typeof value === 'object') {
			return [ key, { phases: value.phases }];
		} else if (key === 'options' && value && value.url && typeof value.url === 'object') {
			return [ key, { url: { href: value.url.href } }];
		}

		return [ key, value ];
	});

	const objectWithoutSymbols = Object.fromEntries(entries);
	return inspect(objectWithoutSymbols);
};

const logger = winston.createLogger({
	level: process.env['LOG_LEVEL'] ?? 'debug',
	format: winston.format.combine(
		winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
		winston.format.prettyPrint(),
		winston.format.printf((info: winston.Logform.TransformableInfo) => {
			const { timestamp, level, scope, message, stack, ...otherFields } = info;
			let result = `[${timestamp as string}] [${level.toUpperCase()}] [${scope as string}] ${message as string}`;

			if (Object.keys(otherFields).length > 0) {
				result += `\n${objectFormatter(otherFields)}`;
			}

			if (stack) {
				result += `\n${info['stack'] as string}`;
			}

			return result;
		}),
	),
	transports: [
		new winston.transports.Console(),
	],
});

export const scopedLogger = (scope: string): winston.Logger => logger.child({ scope });
