import type { Logger } from '@glaze/logger';
import type { SyncConfig, SoloWorkflowConfig } from '@glaze/config';

export type { SyncConfig, SoloWorkflowConfig } from '@glaze/config';

// ─── Database ────────────────────────────────────────────────────────

export type DbRow = Record<string, unknown>;
export type DbExecuteResult = { rows: DbRow[] } | DbRow[];

/**
 * Generic Drizzle database type.
 * Avoids tight coupling to specific Drizzle types.
 */

export interface DrizzleDatabase {
	execute: (query: any) => Promise<any>;
	transaction: (cb: (tx: any) => Promise<any>) => Promise<any>;
}

// ─── Drift Detection ─────────────────────────────────────────────────

/**
 * Result of drift detection.
 */
export interface DriftResult {
	/** Whether there is any drift between schema and database */
	hasDrift: boolean;
	/** SQL statements to apply the changes */
	statements: string[];
	/** Human-readable summary of changes */
	summary: string[];
	/** Current schema snapshot (to be saved after successful migration) */
	currentSnapshot: unknown;
	/** Warnings from drizzle-kit (indicates destructive changes) */
	warnings?: string[];
}

/**
 * Options for drift detection.
 */
export interface DetectDriftOptions {
	/** Database connection string */
	connectionString: string;
	/** Path to the drizzle config file (e.g., 'drizzle.config.ts') */
	configPath: string;
	/** Drizzle database instance for validation */
	db: DrizzleDatabase;
	/** Sync policies */
	sync?: {
		validation?: 'strict' | 'permissive';
		destructive?: 'fail' | 'ask' | 'apply';
	};
	/**
	 * Whether to allow interactive prompts.
	 * @default true (if TTY)
	 */
	interactive?: boolean;
}

// ─── Executor ────────────────────────────────────────────────────────

/**
 * Options for applying statements.
 */
export interface ApplyStatementsOptions {
	/** SQL statements to execute */
	statements: string[];
	/** Drizzle database instance from server */
	db: DrizzleDatabase;
	/** Logger instance */
	logger: Logger;
}

/**
 * Result of applying statements.
 */
export interface ApplyStatementsResult {
	/** Whether all statements were applied successfully */
	success: boolean;
	/** Number of statements applied */
	appliedCount: number;
	/** Error if any occurred */
	error?: Error;
}

// ─── Solo Workflow ───────────────────────────────────────────────────

/**
 * Options for running solo workflow.
 */
export interface SoloWorkflowOptions {
	/** Drizzle database instance */
	db: DrizzleDatabase;
	/** Logger instance */
	logger: Logger;
	/** Solo workflow configuration */
	config: SoloWorkflowConfig;
	/** Database connection string (from env.GLAZE_DATABASE_URL) */
	connectionString: string;
	/** Path to the drizzle config file */
	configPath: string;
}

// ─── Convergence Entry Point ────────────────────────────────────────

/**
 * Options for running the convergence engine.
 * This is the top-level entry point that dispatches to the correct workflow.
 */
export interface ConvergenceOptions {
	/** Resolved sync configuration */
	config: SyncConfig;
	/** Drizzle database instance */
	db: DrizzleDatabase;
	/** Logger instance */
	logger: Logger;
	/** Database connection string (from env.GLAZE_DATABASE_URL) */
	connectionString: string;
	/** Absolute path to the Glaze auth schema file — resolved by core via import.meta.resolve */
	glazeSchemaPath: string;
}
