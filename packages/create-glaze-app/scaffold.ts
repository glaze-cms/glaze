import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getTemplateFiles, type TemplateOptions } from './templates';

export interface ScaffoldResult {
	success: true;
	files: string[];
}

export interface ScaffoldError {
	success: false;
	code: string;
	message: string;
}

function handleMkdirError(err: unknown): ScaffoldError {
	const fsErr = err as NodeJS.ErrnoException;
	switch (fsErr.code) {
		case 'EEXIST':
			return { success: false, code: 'EEXIST', message: 'Directory already exists.' };
		case 'EACCES':
		case 'EPERM':
		case 'EROFS':
			return {
				success: false,
				code: fsErr.code,
				message: 'No permission to create directory at that path.',
			};
		default:
			return {
				success: false,
				code: fsErr.code ?? 'UNKNOWN',
				message: `Failed to create directory: ${fsErr.message}`,
			};
	}
}

export async function scaffold(
	projectDir: string,
	options: TemplateOptions,
): Promise<ScaffoldResult | ScaffoldError> {
	const { includeExampleSchema } = options;

	// Attempt non-recursive mkdir first — throws EEXIST if dir exists,
	// which prevents silently overwriting an existing project.
	// On ENOENT (missing parents), fall back to recursive creation.
	try {
		await mkdir(projectDir);
	} catch (err: unknown) {
		const fsErr = err as NodeJS.ErrnoException;
		if (fsErr.code === 'ENOENT') {
			try {
				await mkdir(projectDir, { recursive: true });
			} catch (retryErr) {
				return handleMkdirError(retryErr);
			}
		} else {
			return handleMkdirError(err);
		}
	}

	if (includeExampleSchema) {
		try {
			await mkdir(join(projectDir, 'schema'));
		} catch (err) {
			return handleMkdirError(err);
		}
	}

	const files = getTemplateFiles(options);

	for (const [filePath, content] of Object.entries(files)) {
		await Bun.write(join(projectDir, filePath), content);
	}

	return { success: true, files: Object.keys(files) };
}
