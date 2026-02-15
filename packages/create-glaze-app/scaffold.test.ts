import { describe, expect, test, afterEach } from 'bun:test';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from './scaffold';
import type { TemplateOptions } from './templates';

const testDir = join(tmpdir(), 'glaze-cli-test');

const defaults: Pick<TemplateOptions, 'databaseUrl' | 'authSecret'> = {
	databaseUrl: 'postgresql://localhost:5432/test_db',
	authSecret: 'a'.repeat(64),
};

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
			...defaults,
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.files).toEqual([
			'package.json',
			'index.ts',
			'tsconfig.json',
			'.env',
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
			...defaults,
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

	test('writes .env with database URL and auth secret', async () => {
		const projectDir = join(testDir, 'env-test');
		const result = await scaffold(projectDir, {
			projectName: 'env-test',
			includeExampleSchema: false,
			databaseUrl: 'postgresql://user:pass@host:5432/mydb',
			authSecret: 'test-secret-1234',
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		const env = await Bun.file(join(projectDir, '.env')).text();
		expect(env).toContain(
			'GLAZE_DATABASE_URL=postgresql://user:pass@host:5432/mydb',
		);
		expect(env).toContain('GLAZE_AUTH_SECRET=test-secret-1234');
		expect(env).toContain('GLAZE_PORT=4000');
	});

	test('creates nested directories like a/b/my-app', async () => {
		const projectDir = join(testDir, 'a', 'b', 'my-app');
		const result = await scaffold(projectDir, {
			projectName: 'my-app',
			includeExampleSchema: false,
			...defaults,
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
			...defaults,
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.files).toContain('schema/posts.ts');

		const posts = await Bun.file(
			join(projectDir, 'schema/posts.ts'),
		).text();
		expect(posts).toContain('pgTable');
	});

	test('returns EEXIST error when directory already exists', async () => {
		const projectDir = join(testDir, 'already-exists');
		await mkdir(projectDir, { recursive: true });

		const result = await scaffold(projectDir, {
			projectName: 'already-exists',
			includeExampleSchema: false,
			...defaults,
		});

		expect(result.success).toBe(false);
		if (result.success) return;

		expect(result.code).toBe('EEXIST');
		expect(result.message).toBe('Directory already exists.');
	});

	test('returns error for permission-denied paths', async () => {
		const readOnlyDir = join(testDir, 'readonly');
		await mkdir(readOnlyDir, { recursive: true });
		await chmod(readOnlyDir, 0o444);

		try {
			const result = await scaffold(join(readOnlyDir, 'child'), {
				projectName: 'child',
				includeExampleSchema: false,
				...defaults,
			});

			expect(result.success).toBe(false);
			if (result.success) return;

			expect(['EACCES', 'EPERM']).toContain(result.code);
		} finally {
			await chmod(readOnlyDir, 0o755);
		}
	});
});
