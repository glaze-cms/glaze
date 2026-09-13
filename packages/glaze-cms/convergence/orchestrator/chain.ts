/**
 * The snapshot chain: what the migration directory says has happened.
 *
 * Every migration `generate` writes carries a `snapshot.json` naming itself and its parent, and
 * `converge()` sweeps the directory on anything but a commit — so a directory that is there is a
 * migration that was generated and committed, on this machine or on one that shares the repository.
 * That is evidence of what happened to a change boot filed and did not apply itself, not proof that
 * it ran against this database; the reconciler confirms it against the live database before the
 * trail believes it. Drizzle's own journal table arrives with the apply path for kept files.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeChangeHash } from './hash.ts';

/** One migration directory's place in the chain. */
export interface ChainLink {
	/** The directory name under `out`. */
	readonly dir: string;
	/** The snapshot's id. */
	readonly id: string;
	/** The snapshot it builds on, as drizzle wrote it: the zero UUID for a first migration. */
	readonly parentId: string;
}

/** Every migration in `out`, and the one nothing builds on yet. */
export interface SnapshotChain {
	/** The migrations, keyed by snapshot id. */
	readonly links: ReadonlyMap<string, ChainLink>;
	/**
	 * The newest snapshot: the one no other names as its parent. `null` when the chain is empty, or
	 * when two migrations both claim to be newest — a fork nobody has reconciled.
	 */
	readonly head: ChainLink | null;
}

/** What walking the chain for a change found. */
export type ChainSearch =
	/** A migration on the way carries the change: it was applied. */
	| { readonly status: 'found'; readonly migration: ChainLink }
	/** The walk reached the starting point without meeting the change. */
	| { readonly status: 'not_found' }
	/** The walk never reached the starting point: the chain was reset, rewritten or forked. */
	| { readonly status: 'unknown_lineage' };

/**
 * Reads a migration's statements, split on drizzle's `--> statement-breakpoint` markers, exactly as
 * written: this is what runs. The fingerprint normalises separately (`computeChangeHash`).
 *
 * @param migrationDir - The migration directory.
 * @returns The statements, in order.
 */
export function readMigrationStatements(migrationDir: string): string[] {
	return readFileSync(join(migrationDir, 'migration.sql'), 'utf8')
		.split('--> statement-breakpoint')
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
}

/**
 * The statements of every migration between the head and `fromParentId`, newest first — what was
 * generated since a request was filed. `null` when the walk never reaches `fromParentId`.
 *
 * @param out - The migration output directory.
 * @param chain - The chain read from it.
 * @param fromParentId - The snapshot to walk back to.
 * @returns The statements on the way, or `null` when the lineage is unknown.
 */
export function statementsSince(
	out: string,
	chain: SnapshotChain,
	fromParentId: string,
): string[] | null {
	const statements: string[] = [];
	let current = chain.head;
	for (let steps = 0; current !== null && steps <= chain.links.size; steps++) {
		if (current.id === fromParentId) return statements;
		try {
			statements.push(...readMigrationStatements(join(out, current.dir)));
		} catch {
			return null;
		}
		const parent = chain.links.get(current.parentId);
		if (parent === undefined) return current.parentId === fromParentId ? statements : null;
		current = parent;
	}
	return null;
}

/**
 * Reads one migration directory's place in the chain, or `null` when its snapshot cannot be read.
 *
 * @param out - The migration output directory.
 * @param dir - The migration directory name.
 * @returns The link, or `null`.
 */
function readLink(out: string, dir: string): ChainLink | null {
	try {
		const raw = JSON.parse(readFileSync(join(out, dir, 'snapshot.json'), 'utf8')) as {
			id?: unknown;
			prevIds?: unknown;
		};
		if (typeof raw.id !== 'string') return null;
		const parents = Array.isArray(raw.prevIds) ? raw.prevIds : [];
		const parent = parents[0];
		return { dir, id: raw.id, parentId: typeof parent === 'string' ? parent : '' };
	} catch {
		return null;
	}
}

/**
 * Reads the snapshot chain in `out`.
 *
 * @param out - The migration output directory.
 * @returns The chain; empty with a `null` head when `out` does not exist.
 */
export function readSnapshotChain(out: string): SnapshotChain {
	let names: string[];
	try {
		names = readdirSync(out, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		names = [];
	}

	const links = new Map<string, ChainLink>();
	for (const name of names) {
		const link = readLink(out, name);
		if (link) links.set(link.id, link);
	}

	const parents = new Set([...links.values()].map((link) => link.parentId));
	const heads = [...links.values()].filter((link) => !parents.has(link.id));
	return { links, head: heads.length === 1 ? (heads[0] as ChainLink) : null };
}

/**
 * Walks the chain back from its head to `fromParentId`, looking for a migration whose statements
 * and parent hash to `hash` — that is, one that applied exactly the change in question.
 *
 * @param out - The migration output directory.
 * @param chain - The chain read from it.
 * @param hash - The change hash to look for.
 * @param fromParentId - The snapshot the change was measured against; the walk stops there.
 * @returns What the walk found.
 */
export function findMigrationByHash(
	out: string,
	chain: SnapshotChain,
	hash: string,
	fromParentId: string,
): ChainSearch {
	let current = chain.head;
	// Bounded by the chain's length; a cycle in `prevIds` is a corrupt chain, not an endless one.
	for (let steps = 0; current !== null && steps <= chain.links.size; steps++) {
		if (current.id === fromParentId) return { status: 'not_found' };
		if (linkHash(out, current) === hash) return { status: 'found', migration: current };
		// The parent is not a migration in the chain: the baseline a first migration builds on, or a
		// snapshot that is gone. Either way the walk ends here.
		const parent = chain.links.get(current.parentId);
		if (parent === undefined) {
			return current.parentId === fromParentId
				? { status: 'not_found' }
				: { status: 'unknown_lineage' };
		}
		current = parent;
	}
	return { status: 'unknown_lineage' };
}

/**
 * The change hash of one migration in the chain, or `null` when its SQL cannot be read.
 *
 * @param out - The migration output directory.
 * @param link - The migration.
 * @returns The hash, or `null`.
 */
export function linkHash(out: string, link: ChainLink): string | null {
	try {
		return computeChangeHash(readMigrationStatements(join(out, link.dir)), link.parentId);
	} catch {
		return null;
	}
}
