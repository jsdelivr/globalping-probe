import { scopedLogger } from './logger.js';

const logger = scopedLogger('adoption-code');

export const logAdoptionCode = (data: { code: string }) => {
	logger.warn(`
                                          ,,         
     __                                 o-°°|\\_____/)
(___()'\`; Your adoption code is: ${data.code}  \\_/|_)     )
/,    /\`                                    \\  __  / 
\\\\"--\\\\                                     (_/ (_/  
		`);
};
