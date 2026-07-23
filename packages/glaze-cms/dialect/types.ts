/** The database dialects Glaze supports. */
export type Dialect = 'postgres' | 'sqlite';

/** Options for opening a database connection for a dialect. */
export interface CreateDatabaseOptions {
	/** Postgres connection string, or the SQLite file path. */
	connection: string;
}

/**
 * Runs a raw SQL statement and returns the result rows. Used for `raw` and, bound to a single
 * connection, inside {@link DatabaseHandle.transaction}.
 *
 * @param sql - The SQL text to execute.
 * @returns The rows produced by the statement.
 */
export type RawExecutor = (sql: string) => Promise<Array<Record<string, unknown>>>;

/**
 * Runs `fn` inside a single database transaction on one reserved connection, committing when it
 * resolves and rolling back if it throws. The standalone form of {@link DatabaseHandle.transaction},
 * so the seam can pass it to helpers.
 *
 * @typeParam T - The value `fn` produces.
 * @param fn - Receives a transaction-bound executor; all its statements share one connection.
 * @returns Whatever `fn` returns, after commit.
 */
export type Transactor = <T>(fn: (tx: RawExecutor) => Promise<T>) => Promise<T>;

/**
 * A live database connection produced by a {@link DialectAdapter}.
 *
 * `db` is the Drizzle instance feature code uses; `raw` is a thin escape hatch the test
 * harness uses to run dialect-agnostic SQL before higher-level query APIs exist.
 *
 * @typeParam TDb - The concrete Drizzle database type for the dialect.
 */
export interface DatabaseHandle<TDb = unknown> {
	/** The Drizzle database instance. */
	db: TDb;
	/**
	 * Runs a raw SQL statement and returns the result rows.
	 * @param sql - The SQL text to execute.
	 * @returns The rows produced by the statement.
	 */
	raw(sql: string): Promise<Array<Record<string, unknown>>>;
	/**
	 * Runs `fn` inside a single database transaction on **one reserved connection** — essential
	 * because `postgres.js` pools connections, so raw `BEGIN`/`COMMIT` could otherwise land on
	 * different connections and silently break atomicity. Commits when `fn` resolves; rolls back and
	 * re-throws if `fn` (or any statement it runs) throws.
	 *
	 * @typeParam T - The value `fn` produces.
	 * @param fn - Receives a transaction-bound executor; all its statements share one connection.
	 * @returns Whatever `fn` returns, after commit.
	 */
	transaction<T>(fn: (tx: RawExecutor) => Promise<T>): Promise<T>;
	/**
	 * **Create-once** materialization of a Drizzle schema module's tables. If the schema's tables do
	 * not yet exist, generates their dialect-correct CREATE DDL (delegated to drizzle-kit, computed
	 * purely from the schema — the live database is **never** introspected or diffed) and applies it
	 * **atomically**; if they already exist, it is a no-op. Glaze uses this at boot to bootstrap its
	 * own internal tables (e.g. the auth schema).
	 *
	 * Deliberately NOT a drizzle-kit "push": a push diffs against the whole database and would drop any
	 * table not in `schema` (i.e. all user content) with no data-loss gating. Create-once only ever
	 * adds its own tables, so it can never touch unrelated data. Schema *evolution* (a later Better Auth
	 * version changing a column) is intentionally out of scope here — that is the convergence engine's
	 * job — and surfaces as a loud runtime error, never silent data loss.
	 *
	 * @param schema - A Drizzle schema module object (keyed table definitions).
	 * @returns The CREATE statements that were applied (empty when the tables already existed).
	 */
	ensureSchema(schema: Record<string, unknown>): Promise<string[]>;
	/**
	 * Closes the underlying connection and releases its resources.
	 * @returns Resolves once the connection is closed.
	 */
	close(): Promise<void>;
}

/**
 * The dialect seam: the single place Postgres and SQLite diverge. In this slice it only opens
 * connections; DDL/type-mapping is delegated to drizzle-kit later (see CLAUDE.md §5).
 */
export interface DialectAdapter {
	/** The dialect this adapter implements. */
	readonly dialect: Dialect;
	/**
	 * Opens a database connection for this dialect.
	 * @param options - Connection details (connection string or SQLite file path).
	 * @returns A live database handle.
	 */
	createDatabase(options: CreateDatabaseOptions): Promise<DatabaseHandle>;
}
