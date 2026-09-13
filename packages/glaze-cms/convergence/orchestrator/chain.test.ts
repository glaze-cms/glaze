import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '../../harness/index.ts';
import { findMigrationByHash, readSnapshotChain } from './chain.ts';
import { computeChangeHash } from './hash.ts';

// The chain is read from hand-written migration directories, so its corners — a fork, an empty
// `out`, a walk that never reaches its start — can be driven directly.

/** Writes a migration directory with the given lineage and SQL. */
function writeMigration(
	out: string,
	name: string,
	id: string,
	parentId: string | null,
	statements: readonly string[],
): void {
	const dir = join(out, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'snapshot.json'),
		JSON.stringify({
			version: 7,
			dialect: 'sqlite',
			id,
			prevIds: [parentId ?? '00000000-0000-0000-0000-000000000000'],
			ddl: [],
		}),
	);
	writeFileSync(join(dir, 'migration.sql'), statements.join('\n--> statement-breakpoint\n'));
}

/** A fresh `out` directory, removed by the caller. */
function tempOut(): string {
	return mkdtempSync(join(tmpdir(), 'glaze-chain-'));
}

test('the head is the snapshot nothing builds on; a fork or an empty directory has none', () => {
	const out = tempOut();
	try {
		expect(readSnapshotChain(out).head).toBeNull();

		writeMigration(out, '0001_a', 'a', null, ['create table t (id integer)']);
		writeMigration(out, '0002_b', 'b', 'a', ['alter table t add column x text']);
		expect(readSnapshotChain(out).head?.id).toBe('b');

		// A second child of `a` is a fork: two newest snapshots, so no head to trust.
		writeMigration(out, '0002_c', 'c', 'a', ['alter table t add column y text']);
		expect(readSnapshotChain(out).head).toBeNull();
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('the walk finds a migration by its change hash, and stops at the starting point', () => {
	const out = tempOut();
	try {
		const dropBody = ['alter table posts drop column body'];
		writeMigration(out, '0001_a', 'a', null, ['create table posts (id integer, body text)']);
		writeMigration(out, '0002_b', 'b', 'a', dropBody);
		writeMigration(out, '0003_c', 'c', 'b', ['alter table posts add column note text']);
		const chain = readSnapshotChain(out);

		// The change filed against `a` was applied as 0002_b, two steps behind the head.
		const found = findMigrationByHash(out, chain, computeChangeHash(dropBody, 'a'), 'a');
		expect(found.status).toBe('found');
		if (found.status === 'found') expect(found.migration.dir).toBe('0002_b');

		// The same SQL against another parent is another change: not found before the walk stops.
		const other = findMigrationByHash(out, chain, computeChangeHash(dropBody, 'b'), 'b');
		expect(other.status).toBe('not_found');

		// A starting point the chain does not contain: the walk runs out without reaching it.
		const lost = findMigrationByHash(out, chain, computeChangeHash(dropBody, 'zz'), 'zz');
		expect(lost.status).toBe('unknown_lineage');
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

// A first migration names drizzle's zero-UUID baseline as its parent; the chain keeps that value as
// written, so a hash computed by the engine at request time matches one recomputed from the file.
test('a first migration hashes with the baseline it names, and a walk stops there', () => {
	const out = tempOut();
	const baseline = '00000000-0000-0000-0000-000000000000';
	try {
		const create = ['create table t (id integer)'];
		writeMigration(out, '0001_a', 'a', null, create);
		const chain = readSnapshotChain(out);
		expect(chain.head?.parentId).toBe(baseline);

		const found = findMigrationByHash(out, chain, computeChangeHash(create, baseline), baseline);
		expect(found.status).toBe('found');
		const missing = findMigrationByHash(out, chain, 'nope', baseline);
		expect(missing.status).toBe('not_found');
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('a comment added to a committed migration file does not change its hash', () => {
	const out = tempOut();
	try {
		const drop = ['alter table posts drop column body'];
		writeMigration(out, '0001_a', 'a', null, ['create table posts (id integer, body text)']);
		writeMigration(out, '0002_b', 'b', 'a', drop);
		const path = join(out, '0002_b', 'migration.sql');
		writeFileSync(path, `-- reviewed by dev\r\n${drop[0]};\r\n`);

		const chain = readSnapshotChain(out);
		const found = findMigrationByHash(out, chain, computeChangeHash([`${drop[0]};`], 'a'), 'a');
		expect(found.status).toBe('found');
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});
