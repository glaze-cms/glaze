/**
 * What the classifier reads and what it says.
 *
 * The input is the flat `ddl` array drizzle-kit writes into every `snapshot.json`: one entry per
 * table, column, index, constraint and so on, each tagged with an `entityType`. Two of those arrays
 * — the parent snapshot's and the new one's — are the whole change. The output sorts every
 * difference between them into one of three kinds, and the rule is that **every** difference lands
 * somewhere: an operation the classifier has no rule for is unclassified, never silently safe.
 */

import type { UnsafeChange } from '../safety/index.ts';

/** One entry of a snapshot's `ddl` array, read defensively. Only `entityType` is guaranteed. */
export type Entity = Readonly<Record<string, unknown>> & { readonly entityType: string };

/** What drizzle did to one entity between the two snapshots. */
export type OperationKind = 'create' | 'drop' | 'alter';

/**
 * One difference between the two snapshots, described by identity rather than SQL: which entity, and
 * whether it appeared, disappeared or changed. `changed` names the fields an `alter` touched.
 */
export interface Operation {
	readonly entityType: string;
	readonly op: OperationKind;
	/** The Postgres schema; `public` on SQLite, which has none. */
	readonly schema: string;
	/** The owning table, for entities that belong to one. */
	readonly table?: string;
	readonly name: string;
	/** The fields an `alter` changed, in snapshot order. */
	readonly changed?: readonly string[];
	/** A short human-readable note, e.g. the type before and after. */
	readonly detail?: string;
}

/**
 * A table drizzle renamed, from a resolved `rename_or_create` decision. `from` is the parent
 * snapshot's name, `to` the new one's.
 */
export interface TableRename {
	/** The Postgres schema; absent means the default, and SQLite. */
	readonly schema?: string;
	readonly from: string;
	readonly to: string;
}

/** A column drizzle renamed within one table. `table` is the table's name in the **new** snapshot. */
export interface ColumnRename {
	/** The Postgres schema; absent means the default, and SQLite. */
	readonly schema?: string;
	readonly table: string;
	readonly from: string;
	readonly to: string;
}

/** Every rename the resolver answered, so the classifier reads a rename as a rename. */
export interface Renames {
	readonly tables: readonly TableRename[];
	readonly columns: readonly ColumnRename[];
}

/**
 * Where every operation in a change landed.
 *
 * - `additive` destroys nothing by construction and applies without asking anybody.
 * - `destructive` removes or rewrites stored values in shape, or is a change the database may refuse;
 *   each is measured against the live database first, and only a measurement that finds something
 *   becomes a decision.
 * - `unclassified` has no rule. The change waits for a person, and says why: not "this destroys
 *   data" but "Glaze does not know whether it does".
 */
export interface Classification {
	readonly additive: readonly Operation[];
	readonly destructive: readonly UnsafeChange[];
	readonly unclassified: readonly Operation[];
}
