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

export async function scaffold(
	projectDir: string,
	options: TemplateOptions,
): Promise<ScaffoldResult | ScaffoldError> {
	const { includeExampleSchema } = options;

	try {
		await mkdir(
			includeExampleSchema ? join(projectDir, 'schema') : projectDir,
			{ recursive: true },
		);
	} catch (err: unknown) {
		const fsErr = err as NodeJS.ErrnoException;
		switch (fsErr.code) {
			case 'EEXIST':
				return {
					success: false,
					code: 'EEXIST',
					message: 'Directory already exists.',
				};
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

	const files = getTemplateFiles(options);

	for (const [filePath, content] of Object.entries(files)) {
		await Bun.write(join(projectDir, filePath), content);
	}

	return { success: true, files: Object.keys(files) };
}
