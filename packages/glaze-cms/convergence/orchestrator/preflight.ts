/**
 * Pre-flight: decide what a freshly-generated migration is, before anything runs.
 *
 * `generate` writes a structured `snapshot.json` (a flat `ddl` array of entities) next to each
 * migration. Diffing it against its **parent** snapshot (found via `prevIds`) is the non-text source
 * for what changed. The classifier sorts every operation in that diff into additive, destructive or
 * unclassified; the destructive ones are then measured against the **live database** by the safety
 * probes, so a column drop over an empty column stops nobody and one over 1,204 values is shown as
 * exactly that. A populated table drop is measured here too — the row-count oracle that runs around
 * the apply verifies it, but the decision is made before the apply, where `audit` has a say.
 *
 * **Fails closed, in two different ways.** The new snapshot always exists (generate just wrote it);
 * if it cannot be read that is an `error`, an internal fault. A parent that `prevIds` names but that
 * cannot be found or read is different: the change is real, Glaze just does not know what it is
 * relative to, so it is one **unclassified** operation and the change waits for a person. A first
 * migration (parent = the zero-UUID baseline) legitimately has no parent → an empty prior schema.
 *
 * Scope note: descriptors are derived for every table in the snapshot. When the internal-namespace
 * work lands (PG `glaze`/`glaze_auth` schemas, SQLite `zz__glaze` prefix), this must exclude those so
 * the gate never probes Glaze's own internal tables — see `glaze-internal-namespace-decision`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyChange, unreadableParent } from '../classifier/index.ts';
import { detectDataLoss } from '../safety/index.ts';

import type { Dialect } from '../../dialect/index.ts';
import type { Classification, Entity, Renames } from '../classifier/index.ts';
import type { DataLossFinding, QueryExecutor } from '../safety/index.ts';

/** The empty-baseline parent id drizzle uses for a first migration (no real parent snapshot). */
const ZERO_SNAPSHOT_ID = '00000000-0000-0000-0000-000000000000';

/** A snapshot reduced to what pre-flight needs: its identity, its parent link, and its entities. */
interface Snapshot {
	readonly id: string;
	readonly prevIds: readonly string[];
	readonly ddl: readonly Entity[];
}

/** The outcome of {@link runPreflight}. */
export type PreflightResult =
	| {
			readonly status: 'ok';
			/** Where every operation landed. */
			readonly classification: Classification;
			/** What the live database said about the destructive ones; empty when nothing is at stake. */
			readonly findings: readonly DataLossFinding[];
	  }
	| { readonly status: 'error'; readonly detail: string };

/**
 * Classifies a freshly-generated migration and measures its destructive operations against the live
 * database.
 *
 * @param query - The dialect-agnostic query executor (the dialect seam's `DatabaseHandle.raw`).
 * @param dialect - The target dialect; gates dialect-specific probes.
 * @param migrationDir - The new migration's directory (holds the just-written `snapshot.json`).
 * @param out - The migration output directory (searched for the parent snapshot).
 * @param renames - The renames the resolver answered, so the classifier reads them as renames.
 * @returns The classification and findings, or `error` when the new snapshot itself is unreadable.
 */
export async function runPreflight(
	query: QueryExecutor,
	dialect: Dialect,
	migrationDir: string,
	out: string,
	renames: Renames = { tables: [], columns: [] },
): Promise<PreflightResult> {
	const next = readSnapshot(migrationDir);
	if (next === null) return { status: 'error', detail: 'could not read the generated snapshot' };

	const parent = resolveParent(next, out);
	if (parent.status === 'unreadable') {
		return {
			status: 'ok',
			classification: {
				additive: [],
				destructive: [],
				unclassified: [unreadableParent(parent.detail)],
			},
			findings: [],
		};
	}

	const classification = classifyChange(parent.ddl, next.ddl, renames);
	const findings = await detectDataLoss(query, dialect, classification.destructive);
	return { status: 'ok', classification, findings };
}

/**
 * Resolves the parent snapshot for a new snapshot, following its `prevIds`. A first migration
 * (zero-UUID baseline) has no parent → an empty prior schema. A parent that `prevIds` names but that
 * cannot be found or read, or a merge with several parents, is `unreadable` — the caller turns that
 * into an unclassified operation, never into an empty diff.
 *
 * @param next - The freshly-generated snapshot.
 * @param out - The migration output directory to search for the parent.
 * @returns The parent's entities, or why they could not be read.
 */
function resolveParent(
	next: Snapshot,
	out: string,
): { status: 'ok'; ddl: readonly Entity[] } | { status: 'unreadable'; detail: string } {
	if (next.prevIds.length > 1) {
		// A merge snapshot has several parents; diffing against only one would miss a drop introduced
		// on another branch. Merges are the deferred team-conflict path.
		return { status: 'unreadable', detail: 'a merge snapshot has several parents' };
	}

	const parentId = next.prevIds[0];
	if (parentId === undefined || parentId === ZERO_SNAPSHOT_ID) return { status: 'ok', ddl: [] };

	for (const dir of listMigrationDirs(out)) {
		const snapshot = readSnapshot(dir);
		if (snapshot?.id === parentId) return { status: 'ok', ddl: snapshot.ddl };
	}

	return { status: 'unreadable', detail: `parent snapshot ${parentId} not found` };
}

/**
 * Reads a migration directory's `snapshot.json`. Defensive: any missing file, bad JSON, or malformed
 * shape yields `null`; the caller decides what that means.
 *
 * @param migrationDir - The migration directory to read `snapshot.json` from.
 * @returns The snapshot, or `null` when it cannot be read/parsed.
 */
function readSnapshot(migrationDir: string): Snapshot | null {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(join(migrationDir, 'snapshot.json'), 'utf8'));
	} catch {
		return null;
	}

	if (!isRecord(raw)) return null;
	const { id, prevIds, ddl } = raw;
	if (typeof id !== 'string' || !Array.isArray(prevIds) || !Array.isArray(ddl)) return null;

	return {
		id,
		prevIds: prevIds.filter((value): value is string => typeof value === 'string'),
		ddl: ddl.filter(isEntity),
	};
}

/**
 * Lists the migration directories in `out` as full paths, or `[]` when `out` does not exist.
 *
 * @param out - The migration output directory.
 * @returns The migration directory paths.
 */
function listMigrationDirs(out: string): string[] {
	try {
		return readdirSync(out, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(out, entry.name));
	} catch {
		return [];
	}
}

/**
 * Narrows an unknown value to a non-null object (a record) for safe field access.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrows a raw `ddl` entry to an {@link Entity}: a record with a string `entityType`.
 *
 * @param value - The raw entry.
 * @returns `true` when it is an entity.
 */
function isEntity(value: unknown): value is Entity {
	return isRecord(value) && typeof value['entityType'] === 'string';
}
