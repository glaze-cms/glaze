// ─── Workflow Configuration ──────────────────────────────────────────

/**
 * Solo workflow configuration.
 * Direct push to database, no migration files.
 */
export interface SoloWorkflowConfig {
	/**
	 * Handling destructive changes during sync (e.g. DROP COLUMN).
	 *
	 * - 'fail': Abort if any destructive change is detected.
	 * - 'ask': Prompt the user for confirmation.
	 * - 'apply': Automatically apply changes (Dangerous!).
	 *
	 * @default 'ask' in development, 'fail' in production
	 */
	destructive?: 'fail' | 'ask' | 'apply';

	/**
	 * Pre-flight validation strictness.
	 * - 'strict': Validate data constraints (blocks invalid changes)
	 * - 'permissive': Skip validation, attempt apply (may fail with SQL error)
	 *
	 * @default 'permissive' in development, 'strict' in production
	 */
	validation?: 'strict' | 'permissive';

	/**
	 * Path to the user's drizzle config file.
	 * @default 'drizzle.config.ts'
	 */
	configPath?: string;
}

/**
 * Team workflow configuration.
 * Uses migration files for version control.
 */
export interface TeamWorkflowConfig {
	/**
	 * Automatically apply pending migrations on startup?
	 *
	 * @default true in development, false in production
	 */
	autoRun?: boolean;

	/**
	 * Path to drizzle config file.
	 * @default 'drizzle.config.ts'
	 */
	configPath?: string;
}

/**
 * Sync configuration - discriminated union by workflow type.
 * `workflow: 'solo'` only allows `solo` config, `workflow: 'team'` only allows `team` config.
 */
export type SyncConfig = {
	/**
	 * Whether to enable database synchronization.
	 * @default true
	 */
	enabled?: boolean;
} & (
	| { workflow: 'solo'; solo?: SoloWorkflowConfig; team?: never }
	| { workflow: 'team'; team?: TeamWorkflowConfig; solo?: never }
);
