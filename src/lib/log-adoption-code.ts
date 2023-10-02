import { scopedLogger } from './logger';

const logger = scopedLogger('adoption-code');

export const logAdoptionCode = (code: string) => {
	logger.warn(`
                                          ,,         
     __                                 o-°°|\\_____/)
(___()'\`; Your adoption code is: ${code}  \\_/|_)     )
/,    /\`                                    \\  __  / 
\\\\"--\\\\                                     (_/ (_/  
		`);
};
