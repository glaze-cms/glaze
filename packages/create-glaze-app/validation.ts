import { isAbsolute, normalize } from 'node:path';

export function validateProjectName(value = ''): string | undefined {
	if (!value.trim()) return 'Please enter a directory name.';
	if (isAbsolute(value))
		return 'Please use a folder name like "my-glaze-app", not a full path.';

	const normalized = normalize(value);
	if (normalized === '.' || normalized === '..' || normalized.includes('..'))
		return 'Please use a folder name like "my-glaze-app" without ".." segments.';
}

export function validateDatabaseUrl(value = ''): string | undefined {
	if (!value.trim()) return 'Please enter a database URL.';
	if (!value.startsWith('postgres://') && !value.startsWith('postgresql://'))
		return 'Must be a valid PostgreSQL connection string (starts with postgres:// or postgresql://).';
}

export function generateAuthSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
