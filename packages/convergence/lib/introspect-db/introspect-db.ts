import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface IntrospectDbOptions {
	shell?: typeof Bun.$;
}

/**
 * Runs `drizzle-kit pull` in a temporary directory and returns the generated
 * schema.ts content as a string. Cleans up the temp directory on exit.
 */
export async function introspectToSchema(
	connectionString: string,
	options: IntrospectDbOptions = {},
): Promise<string> {
	const $ = options.shell ?? Bun.$;

	const tempDir = mkdtempSync(join(process.cwd(), '.glaze-introspection-'));
	const schemaOutDir = join(tempDir, 'out');
	const configPath = join(tempDir, 'drizzle.config.ts');

	try {
		const configCode = `
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
	out: ${JSON.stringify(schemaOutDir)},
	schema: ${JSON.stringify(join(schemaOutDir, 'schema.ts'))},
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL! },
});`;

		writeFileSync(configPath, configCode);

		const result = await $`bunx drizzle-kit pull --config=${configPath}`
			.env({ ...process.env, DATABASE_URL: connectionString })
			.quiet();

		if (result.exitCode !== 0) {
			throw new Error(`drizzle-kit pull failed: ${result.stderr.toString()}`);
		}

		return await Bun.file(join(schemaOutDir, 'schema.ts')).text();
	} finally {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
}
