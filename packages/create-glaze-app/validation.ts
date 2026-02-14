import { isAbsolute } from 'node:path';

export function validateProjectName(value = ''): string | undefined {
	if (!value.trim()) return 'Please enter a directory name.';
	if (isAbsolute(value))
		return 'Please use a folder name like "my-glaze-app", not a full path.';
}
