export { applyMigration } from './executor.ts';
export { captureRowCounts, findUnexpectedLosses } from './verification.ts';
export { listUserTables } from './introspection.ts';

export type {
	ApplyMigrationOptions,
	ApplyResult,
	TableRename,
	UnexpectedRowLoss,
} from './types.ts';
