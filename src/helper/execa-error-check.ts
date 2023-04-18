import type { ExecaError } from 'execa';

export const isExecaError = (error: unknown): error is ExecaError => (error as ExecaError).stderr !== undefined;
