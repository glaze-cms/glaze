import { resolve, dirname, relative } from 'node:path';
import { exists } from 'fs/promises';

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

	// Validate user config exists
	if (!(await exists(absoluteUserConfigPath))) {
		throw new Error(`Drizzle config not found: ${userConfigPath}`);
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

	const relativeGlazeSchemaPath = relative(wrappedConfigDir, glazeSchemaPath)
		.replace(/\\/g, '/') // Windows compat
		.replace(/\.ts$/, ''); // Remove extension

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
