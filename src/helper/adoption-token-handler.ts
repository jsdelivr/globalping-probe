import type { Socket } from 'socket.io-client';
import { scopedLogger } from '../lib/logger.js';

const logger = scopedLogger('adoption-token-handler');

export const adoptionTokenHandler = (socket: Socket) => {
	const adoptionToken = process.env['GP_ADOPTION_TOKEN'];

	if (adoptionToken) {
		socket.emit('probe:adoption:token', adoptionToken);
	} else {
		logger.info(`GP_ADOPTION_TOKEN env var wasn't provided.`);
	}
};
