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
	const trimmed = value.trim();
	if (!trimmed) return 'Please enter a database URL.';
	if (!trimmed.startsWith('postgres://') && !trimmed.startsWith('postgresql://'))
		return 'Must be a valid PostgreSQL connection string (starts with postgres:// or postgresql://).';

	if (/[\r\n]/.test(trimmed))
		return 'Connection string must not contain newlines.';

	const afterProtocol = trimmed.replace(/^postgres(ql)?:\/\//, '');
	if (!afterProtocol || afterProtocol === '/')
		return 'Connection string is missing a host. Example: postgresql://localhost:5432/mydb';
}

export function generateAuthSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
