import config from 'config';

// Bounds for the optional per-measurement `timeout` parameter (in seconds).
// The API is the source of truth for validation; these are the probe-side
// defensive limits and should stay in sync with it.
export const MIN_MEASUREMENT_TIMEOUT = 1;
export const MAX_MEASUREMENT_TIMEOUT = 60;

/**
 * Returns the hard-kill backstop (in milliseconds) for a spawned measurement
 * command. When a per-measurement `timeout` (seconds) is provided it is used as
 * the deadline; otherwise the global `commands.timeout` is used, preserving the
 * previous behaviour.
 *
 * `graceSeconds` extends the backstop past the requested timeout so a tool with
 * its own native deadline (e.g. `ping -w`) can exit cleanly before the process
 * is force-killed. For tools without a native deadline pass `0` so they are
 * killed exactly at the requested timeout.
 *
 * @param timeout The per-measurement timeout in seconds, or undefined.
 * @param graceSeconds Extra seconds added on top of `timeout` for the backstop.
 */
export const getBackstopTimeout = (timeout?: number, graceSeconds = 0): number => {
	if (timeout != null) {
		return (timeout + graceSeconds) * 1000;
	}

	return config.get<number>('commands.timeout') * 1000;
};
