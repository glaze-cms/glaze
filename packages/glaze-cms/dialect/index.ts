import { postgresDialect } from './postgres.ts';
import { sqliteDialect } from './sqlite.ts';

import type { Dialect, DialectAdapter } from './types.ts';

export type { ConstraintClassifier, ConstraintKind, ConstraintViolation } from './errors.ts';
export type {
	CreateDatabaseOptions,
	DatabaseHandle,
	Dialect,
	DialectAdapter,
	RawExecutor,
} from './types.ts';

/** Registry of dialect adapters, keyed by dialect. */
const ADAPTERS: Record<Dialect, DialectAdapter> = {
	postgres: postgresDialect,
	sqlite: sqliteDialect,
};

/**
 * Resolves the dialect seam, returning the adapter for the given dialect.
 *
 * Called once at the composition root; downstream logic depends on {@link DialectAdapter},
 * never on which dialect is active.
 *
 * @param dialect - The dialect to resolve.
 * @returns The matching dialect adapter.
 */
export function resolveDialect(dialect: Dialect): DialectAdapter {
	return ADAPTERS[dialect];
}
