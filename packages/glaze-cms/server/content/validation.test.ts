import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveConfig } from '#config';
import { expect, test } from '#harness';

import { loadCollections } from './schema.ts';
import { buildCollectionSchemas } from './validation.ts';

import type { GlazeConfig } from '#config';

/** Temp schema fixtures under `node_modules` (so `drizzle-orm/*` resolves), emitted `.mjs` — see the loader test. */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'glaze-content-validation-fixture-',
);

/** Reads a TypeBox object schema's `required` list. */
function requiredOf(schema: unknown): string[] {
	return (schema as { required?: string[] }).required ?? [];
}

/** Reads a TypeBox object schema's property keys. */
function propsOf(schema: unknown): string[] {
	return Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {});
}

test('buildCollectionSchemas: insert requires only NOT-NULL-without-default columns', async () => {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const path = join(dir, 'posts.mjs');
		writeFileSync(
			path,
			"import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';\n" +
				"export const posts = sqliteTable('posts', { id: integer('id').primaryKey(), " +
				"title: text('title').notNull(), views: integer('views').default(0), note: text('note') });\n",
		);
		const config: GlazeConfig = { dialect: 'sqlite', connection: 'unused', schema: path };
		const [collection] = await loadCollections(resolveConfig(config));
		if (!collection) throw new Error('expected the posts collection');

		const { body, update } = buildCollectionSchemas(collection);

		// A NOT-NULL column with no default is required; a defaulted or nullable column is optional.
		const required = requiredOf(body);
		expect(required).toContain('title');
		expect(required.includes('views')).toBe(false);
		expect(required.includes('note')).toBe(false);

		// The update schema drops the primary key and requires nothing (a partial update).
		const updateProps = propsOf(update);
		expect(updateProps.includes('id')).toBe(false);
		expect(updateProps).toContain('title');
		expect(requiredOf(update)).toHaveLength(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
