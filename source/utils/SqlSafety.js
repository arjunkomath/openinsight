const MUTATION_KEYWORD_RE =
	/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|CALL|PRAGMA|ATTACH|DETACH|VACUUM|INTO)\b/i;

export function isReadOnlyQuery(sql) {
	const value = String(sql || '');
	const normalized = value.toUpperCase().replace(/\s+/g, ' ').trim();

	if (value.includes(';')) {
		const parts = value.split(';').filter(part => part.trim());
		if (parts.length > 1) return false;
	}

	if (MUTATION_KEYWORD_RE.test(value)) return false;

	return normalized.startsWith('SELECT') || normalized.startsWith('WITH');
}
