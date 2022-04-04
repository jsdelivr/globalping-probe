import type {ExecaError} from 'execa';

export const isExecaError = (error: any): error is ExecaError => (error as ExecaError).stderr !== undefined;
