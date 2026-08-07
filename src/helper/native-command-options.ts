export const getNativeCommandOptions = (timeout: number) => ({
	timeout,
	env: { LC_ALL: 'C' },
});
