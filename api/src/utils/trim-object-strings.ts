export function trimObjectStrings(obj: any): any {
	if (typeof obj !== 'object' || obj === null) {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map(trimObjectStrings);
	}

	for (const key in obj) {
		if (typeof obj[key] === 'string') {
			obj[key] = obj[key].trim();
		} else if (typeof obj[key] === 'object' && obj[key] !== null) {
			obj[key] = trimObjectStrings(obj[key]);
		}
	}

	return obj;
}
