import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '../../harness/index.ts';
import { decodeEnvelope } from '../envelope/index.ts';
import { createGenerateCompute } from './generate.ts';
import { resolveWithDecisions } from './index.ts';

// Integration: runs the REAL drizzle-kit generate (file-only, no DB) so the hardened decoder and
// resolution loop are exercised against actual rc.4 envelopes, not hand-written ones.

/** The package root — fixtures must live here so their `drizzle-orm` import resolves. */
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

/** A one-table SQLite schema module with a single named text column. */
function sqliteSchema(column: string): string {
	return `import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
	id: integer('id').primaryKey(),
	${column}: text('${column}'),
});
`;
}

/** Concatenates every generated migration's SQL under `out`. */
function allMigrationSql(out: string): string {
	return readdirSync(out, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => readFileSync(join(out, entry.name, 'migration.sql'), 'utf8'))
		.join('\n');
}

test('generate: baseline, then a rename resolved through the full loop (sqlite)', async () => {
	const dir = join(packageRoot, `.tmp-gen-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	try {
		// Distinct file paths avoid the in-process module cache (the same path would re-import stale).
		const schemaA = join(dir, 'schema-a.ts');
		const schemaB = join(dir, 'schema-b.ts');
		const out = join(dir, 'migrations');
		writeFileSync(schemaA, sqliteSchema('nickname'));
		writeFileSync(schemaB, sqliteSchema('handle'));

		const baseline = decodeEnvelope(
			await createGenerateCompute({ dialect: 'sqlite', schema: schemaA, out })([]),
		);
		expect(baseline.status).toBe('ok');

		// v2 renames nickname → handle; drizzle surfaces rename_or_create, the resolver picks rename.
		const compute = createGenerateCompute({ dialect: 'sqlite', schema: schemaB, out });
		const outcome = await resolveWithDecisions(compute, () => ({
			action: 'rename',
			from: ['public', 'users', 'nickname'],
		}));

		expect(outcome.status).toBe('ok');
		expect(allMigrationSql(out).includes('RENAME')).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
