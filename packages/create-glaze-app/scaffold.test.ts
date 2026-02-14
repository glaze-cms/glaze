import { describe, expect, test, afterEach } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from './scaffold';

const testDir = join(tmpdir(), 'glaze-cli-test');

afterEach(async () => {
	try {
		await rm(testDir, { recursive: true, force: true });
	} catch {
		// already cleaned up
	}
});

describe('scaffold', () => {
	test('creates base files without schema', async () => {
		const projectDir = join(testDir, 'no-schema');
		const result = await scaffold(projectDir, {
			projectName: 'no-schema',
			includeExampleSchema: false,
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.files).toEqual([
			'package.json',
			'index.ts',
			'tsconfig.json',
			'.env.example',
		]);

		const pkg = await Bun.file(join(projectDir, 'package.json')).json();
		expect(pkg.name).toBe('no-schema');

		const indexTs = await Bun.file(join(projectDir, 'index.ts')).text();
		expect(indexTs).toContain('schema: {},');
	});

	test('creates schema files when includeExampleSchema is true', async () => {
		const projectDir = join(testDir, 'with-schema');
		const result = await scaffold(projectDir, {
			projectName: 'with-schema',
			includeExampleSchema: true,
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.files).toContain('schema/index.ts');
		expect(result.files).toContain('schema/posts.ts');
		expect(result.files).toContain('schema/authors.ts');
		expect(result.files).toContain('drizzle.config.ts');

		const indexTs = await Bun.file(join(projectDir, 'index.ts')).text();
		expect(indexTs).toContain("import * as schema from './schema'");

		const schemaIndex = await Bun.file(
			join(projectDir, 'schema/index.ts'),
		).text();
		expect(schemaIndex).toContain("from './posts'");
		expect(schemaIndex).toContain("from './authors'");
	});

	test('creates nested directories like a/b/my-app', async () => {
		const projectDir = join(testDir, 'a', 'b', 'my-app');
		const result = await scaffold(projectDir, {
			projectName: 'my-app',
			includeExampleSchema: false,
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		const pkg = await Bun.file(join(projectDir, 'package.json')).json();
		expect(pkg.name).toBe('my-app');
	});

	test('creates nested directories with schema', async () => {
		const projectDir = join(testDir, 'x', 'y', 'z');
		const result = await scaffold(projectDir, {
			projectName: 'z',
			includeExampleSchema: true,
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.files).toContain('schema/posts.ts');

		const posts = await Bun.file(
			join(projectDir, 'schema/posts.ts'),
		).text();
		expect(posts).toContain('pgTable');
	});

	test('returns error for permission-denied paths', async () => {
		const result = await scaffold('/proc/fake-glaze-app', {
			projectName: 'fake',
			includeExampleSchema: false,
		});

		expect(result.success).toBe(false);
		if (result.success) return;

		expect(['EACCES', 'EPERM', 'EROFS']).toContain(result.code);
	});
});
