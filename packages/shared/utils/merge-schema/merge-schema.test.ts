import { expect, test, describe, beforeEach, afterEach } from 'bun:test';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { mergeConfig } from './merge-schema';

const TMP_DIR = resolve(import.meta.dirname, '.test-tmp');
const USER_CONFIG_PATH = resolve(TMP_DIR, 'drizzle.config.ts');
const GLAZE_SCHEMA_PATH = resolve(TMP_DIR, 'node_modules/@glaze/core/schema.ts');

function setupFixtures() {
	mkdirSync(dirname(USER_CONFIG_PATH), { recursive: true });
	writeFileSync(USER_CONFIG_PATH, 'export default {}');

	mkdirSync(dirname(GLAZE_SCHEMA_PATH), { recursive: true });
	writeFileSync(GLAZE_SCHEMA_PATH, 'export const authSchema = {}');
}

describe('mergeConfig', () => {
	beforeEach(() => {
		setupFixtures();
	});

	afterEach(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	test('should throw if user config does not exist', async () => {
		const missingPath = resolve(TMP_DIR, 'missing.config.ts');

		expect(
			mergeConfig({
				userConfigPath: missingPath,
				glazeSchemaPath: GLAZE_SCHEMA_PATH,
			}),
		).rejects.toThrow('Drizzle config not found');
	});

	test('should write merged config to .glaze directory', async () => {
		const result = await mergeConfig({
			userConfigPath: USER_CONFIG_PATH,
			glazeSchemaPath: GLAZE_SCHEMA_PATH,
		});

		expect(result).toBe(
			resolve(dirname(USER_CONFIG_PATH), '.glaze', 'drizzle.merged.config.ts'),
		);

		const content = readFileSync(result, 'utf-8');
		expect(content).toContain("import { defineConfig } from 'drizzle-kit'");
		expect(content).toContain('import userConfig from');
	});

	test('should include relative path to user config', async () => {
		const result = await mergeConfig({
			userConfigPath: USER_CONFIG_PATH,
			glazeSchemaPath: GLAZE_SCHEMA_PATH,
		});

		const content = readFileSync(result, 'utf-8');

		// User config is one level up from .glaze/
		expect(content).toContain("import userConfig from '../drizzle.config'");
	});

	test('should include relative path to glaze schema', async () => {
		const result = await mergeConfig({
			userConfigPath: USER_CONFIG_PATH,
			glazeSchemaPath: GLAZE_SCHEMA_PATH,
		});

		const content = readFileSync(result, 'utf-8');

		// Schema path should be relative from .glaze/ dir to the schema
		expect(content).toContain('node_modules/@glaze/core/schema');
		// Should not contain absolute path
		expect(content).not.toContain(TMP_DIR);
	});

	test('should strip .ts extension from both paths', async () => {
		const result = await mergeConfig({
			userConfigPath: USER_CONFIG_PATH,
			glazeSchemaPath: GLAZE_SCHEMA_PATH,
		});

		const content = readFileSync(result, 'utf-8');

		// Neither import path should end with .ts
		const importLines = content
			.split('\n')
			.filter((line) => line.includes('import '));
		for (const line of importLines) {
			expect(line).not.toMatch(/\.ts['"]/);
		}

		// Schema in the schema array should also not end with .ts
		const schemaLine = content
			.split('\n')
			.find((line) => line.includes('schema: ['));
		expect(schemaLine).not.toMatch(/\.ts'/);
	});

	test('should include schema filter with auth and drizzle', async () => {
		const result = await mergeConfig({
			userConfigPath: USER_CONFIG_PATH,
			glazeSchemaPath: GLAZE_SCHEMA_PATH,
		});

		const content = readFileSync(result, 'utf-8');
		expect(content).toContain('"auth"');
		expect(content).toContain('"drizzle"');
	});

	test('should use forward slashes in generated paths', async () => {
		const result = await mergeConfig({
			userConfigPath: USER_CONFIG_PATH,
			glazeSchemaPath: GLAZE_SCHEMA_PATH,
		});

		const content = readFileSync(result, 'utf-8');

		// Extract all path strings from imports and schema array
		const pathMatches = content.match(/'[^']+'/g) ?? [];
		for (const p of pathMatches) {
			if (p.includes('/') || p.includes('..')) {
				expect(p).not.toContain('\\');
			}
		}
	});

	test('should handle absolute userConfigPath', async () => {
		const result = await mergeConfig({
			userConfigPath: USER_CONFIG_PATH,
			glazeSchemaPath: GLAZE_SCHEMA_PATH,
		});

		expect(result).toContain('.glaze/drizzle.merged.config.ts');
		const content = readFileSync(result, 'utf-8');
		expect(content).toContain("import userConfig from '../drizzle.config'");
	});

	test('should include DATABASE_URL in dbCredentials', async () => {
		const result = await mergeConfig({
			userConfigPath: USER_CONFIG_PATH,
			glazeSchemaPath: GLAZE_SCHEMA_PATH,
		});

		const content = readFileSync(result, 'utf-8');
		expect(content).toContain('process.env.DATABASE_URL');
	});
});
