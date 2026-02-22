import { resolve, dirname, relative } from 'node:path';
import { access } from 'node:fs/promises';

export interface MergeConfigOptions {
	/** Relative or absolute path to the user's drizzle config file. */
	userConfigPath: string;
	/** Absolute path to the glaze schema file to merge into the config. */
	glazeSchemaPath: string;
}

/**
 * Generates a merged Drizzle config that combines the user's config with a
 * glaze schema. The merged config is written to `.glaze/drizzle.merged.config.ts`
 * next to the user's config.
 *
 * @returns The absolute path to the generated merged config file.
 * @throws If the user config file does not exist.
 */
export async function mergeConfig({
	userConfigPath,
	glazeSchemaPath,
}: MergeConfigOptions): Promise<string> {
	const cwd = process.cwd();
	const absoluteUserConfigPath = resolve(cwd, userConfigPath);

	try {
		await access(absoluteUserConfigPath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			throw new Error(`Drizzle config not found: ${userConfigPath}`);
		}
		throw err;
	}

	try {
		await access(glazeSchemaPath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			throw new Error(`Glaze schema not found at: ${glazeSchemaPath}`);
		}
		throw err;
	}

	const userConfigDir = dirname(absoluteUserConfigPath);
	const wrappedConfigPath = resolve(
		userConfigDir,
		'.glaze',
		'drizzle.merged.config.ts',
	);
	const wrappedConfigDir = dirname(wrappedConfigPath);

	// Relative path from wrapped config to user config
	const relativeUserConfigPath = relative(
		wrappedConfigDir,
		absoluteUserConfigPath,
	)
		.replace(/\\/g, '/') // Windows compat
		.replace(/\.ts$/, ''); // Remove extension

	// Glaze schema path must be relative to CWD because drizzle-kit resolves
	// schema file paths relative to the process working directory, not the config file.
	// The .ts extension must be kept — drizzle-kit requires it for schema file paths
	// (unlike TypeScript imports where the extension must be omitted).
	const relativeGlazeSchemaPath = relative(cwd, glazeSchemaPath)
		.replace(/\\/g, '/'); // Windows compat only

	const content = `
import { defineConfig } from 'drizzle-kit';
import userConfig from '${relativeUserConfigPath}';

const userSchemas = !userConfig.schema
  ? []
  : Array.isArray(userConfig.schema)
    ? userConfig.schema
    : [userConfig.schema];

const userFilters = Array.isArray(userConfig.schemaFilter)
  ? userConfig.schemaFilter
  : (userConfig.schemaFilter ? [userConfig.schemaFilter] : ["public"]);

export default defineConfig({
  ...userConfig,
  schema: [...userSchemas, '${relativeGlazeSchemaPath}'],
  schemaFilter: [...new Set([...userFilters, "auth", "drizzle"])],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
`;

	await Bun.write(wrappedConfigPath, content, { createPath: true });
	return wrappedConfigPath;
}
