export const truncateToWellFormedString = (value: string, maxLength: number): string => {
	if (maxLength <= 0) {
		return '';
	}

	let truncated = value.substring(0, maxLength);
	const lastCode = truncated.charCodeAt(truncated.length - 1);

	if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
		truncated = truncated.substring(0, truncated.length - 1);
	}

	return truncated;
};
