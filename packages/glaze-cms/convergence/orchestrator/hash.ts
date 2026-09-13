/**
 * The change hash — the fingerprint that says whether two detected changes are the same change.
 *
 * It is what the boot path compares an open pending approval against: same hash means the request
 * already on file still describes the schema, a different hash means the schema moved and the
 * request is stale. It is also re-verified at approval time, so a change cannot be approved and then
 * applied as something else.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The separator between hashed parts. NUL for the same reason the differ uses it: a printable
 * separator collides on identifiers that legitimately contain it, and a hash collision here fails
 * **open** — two different changes would look like one, and the second would inherit the first's
 * approval.
 */
const PART_SEPARATOR = '\0';

/** What a drizzle snapshot carries of its place in the chain. */
interface SnapshotIdentity {
	readonly id?: unknown;
	readonly prevIds?: unknown;
}

/**
 * Reads the id of the snapshot a freshly-generated migration builds on — what the database is
 * expected to look like before this change applies.
 *
 * A first migration names drizzle's zero-UUID baseline as its parent, and that is returned as
 * written: the chain reader keeps the same value, so the two agree on what a first migration hashes
 * to. `''` is returned only when the snapshot cannot be read or does not carry a parent, so the hash
 * then rests on the statements alone: weaker, never wrong.
 *
 * @param migrationDir - The freshly-generated migration directory.
 * @returns The parent snapshot id, or `''` when there is none.
 */
export function readParentSnapshotId(migrationDir: string): string {
	try {
		const raw = readFileSync(join(migrationDir, 'snapshot.json'), 'utf8');
		const snapshot = JSON.parse(raw) as SnapshotIdentity;
		const parents = snapshot.prevIds;
		if (!Array.isArray(parents)) return '';
		const parent = parents[0];
		return typeof parent === 'string' ? parent : '';
	} catch {
		return '';
	}
}

/**
 * Fingerprints one detected change: its ordered statements plus the snapshot it builds on.
 *
 * The parent snapshot is part of the fingerprint because the same SQL means different things from
 * different starting points — `ALTER TABLE posts DROP COLUMN subtitle` against a database that has
 * since been rebuilt is not the change anybody approved.
 *
 * @param statements - The migration's statements, in order.
 * @param parentSnapshotId - The snapshot the change builds on (`''` when it is the first).
 * @returns The hash, as lowercase hex.
 */
export function computeChangeHash(statements: readonly string[], parentSnapshotId: string): string {
	const parts = [...statements.map(normalizeStatement), parentSnapshotId];
	return createHash('sha256').update(parts.join(PART_SEPARATOR)).digest('hex');
}

/**
 * The form of a statement that is hashed: line endings normalised, comment-only lines dropped, so a
 * migration file checked out with CRLF or annotated by a reviewer still fingerprints as the change it
 * carries. Only the fingerprint sees this; what runs is the file as written.
 *
 * @param statement - One statement, as read from `migration.sql`.
 * @returns The statement as hashed.
 */
function normalizeStatement(statement: string): string {
	return statement
		.replaceAll('\r\n', '\n')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('--'))
		.join('\n')
		.trim();
}
