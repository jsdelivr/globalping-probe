/**
 * You don't (may not) need Lodash/Underscore
 * https://github.com/you-dont-need/You-Dont-Need-Lodash-Underscore#_random
 * Released under MIT license <https://github.com/you-dont-need/You-Dont-Need-Lodash-Underscore/blob/master/LICENSE>
 */
export const random = (a = 1, b = 0) => {
	const lower = Math.ceil(Math.min(a, b));
	const upper = Math.floor(Math.max(a, b));
	return Math.floor(lower + Math.random() * (upper - lower + 1));
};
