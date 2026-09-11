import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '../../harness/index.ts';
import { runPreflight } from './preflight.ts';

// Pre-flight over hand-written snapshot files, so the parent lookup can be driven into the corners
// drizzle-kit itself never produces: a parent it names but that is not there, and a merge.

/** Writes a migration dir holding a snapshot with the given identity and entities. */
function writeMigration(
	out: string,
	name: string,
	snapshot: { id: string; prevIds: string[]; ddl: unknown[] },
): string {
	const dir = join(out, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'snapshot.json'),
		JSON.stringify({ version: '7', dialect: 'sqlite', ...snapshot }),
	);
	return dir;
}

/** A query executor that must not be reached: nothing here should be measured. */
const neverQueried = (): Promise<never> => Promise.reject(new Error('no measurement expected'));

const USERS = [
	{ entityType: 'tables', name: 'users' },
	{
		entityType: 'columns',
		table: 'users',
		name: 'id',
		type: 'integer',
		notNull: true,
		default: null,
	},
];

test('a parent the snapshot names but that is missing is one unclassified operation', async () => {
	const out = mkdtempSync(join(tmpdir(), 'glaze-preflight-'));
	try {
		const next = writeMigration(out, '0002_next', { id: 'b', prevIds: ['a'], ddl: [] });

		const result = await runPreflight(neverQueried, 'sqlite', next, out);

		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.findings).toEqual([]);
		expect(result.classification.destructive).toEqual([]);
		expect(
			result.classification.unclassified.map((op) => [op.entityType, op.name, op.detail]),
		).toEqual([['snapshot', 'parent', 'parent snapshot a not found']]);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('a merge snapshot is one unclassified operation, even when its parents are present', async () => {
	const out = mkdtempSync(join(tmpdir(), 'glaze-preflight-'));
	try {
		writeMigration(out, '0001_a', { id: 'a', prevIds: [], ddl: USERS });
		writeMigration(out, '0001_b', { id: 'b', prevIds: [], ddl: USERS });
		const next = writeMigration(out, '0002_merge', { id: 'c', prevIds: ['a', 'b'], ddl: [] });

		const result = await runPreflight(neverQueried, 'sqlite', next, out);

		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		// Not an empty diff: the table drop in `ddl: []` is not measured, because what it is relative
		// to is not known.
		expect(result.classification.destructive).toEqual([]);
		expect(result.classification.unclassified.map((op) => op.detail)).toEqual([
			'a merge snapshot has several parents',
		]);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('a first migration diffs against nothing, and a found parent against itself', async () => {
	const out = mkdtempSync(join(tmpdir(), 'glaze-preflight-'));
	try {
		const first = writeMigration(out, '0001_first', {
			id: 'a',
			prevIds: ['00000000-0000-0000-0000-000000000000'],
			ddl: USERS,
		});
		const created = await runPreflight(neverQueried, 'sqlite', first, out);
		expect(created.status).toBe('ok');
		if (created.status !== 'ok') return;
		expect(created.classification.additive.map((op) => op.name)).toEqual(['users']);

		const second = writeMigration(out, '0002_second', { id: 'b', prevIds: ['a'], ddl: USERS });
		const unchanged = await runPreflight(neverQueried, 'sqlite', second, out);
		expect(unchanged.status).toBe('ok');
		if (unchanged.status !== 'ok') return;
		expect(unchanged.classification).toEqual({ additive: [], destructive: [], unclassified: [] });
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});
