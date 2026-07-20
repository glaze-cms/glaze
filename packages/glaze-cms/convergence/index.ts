export { applyMigration, captureRowCounts, findUnexpectedLosses } from './apply/index.ts';
export {
	checkColumnLengthOverflow,
	checkNotNullColumnOnNonEmpty,
	checkNotNullOnExistingNulls,
	checkUniqueOnDuplicates,
	DATA_LOSS_CODES,
	detectDataLoss,
} from './safety/index.ts';

export type {
	ApplyMigrationOptions,
	ApplyResult,
	TableRename,
	UnexpectedRowLoss,
} from './apply/index.ts';
export type { DataLossCode, DataLossFinding, QueryExecutor, UnsafeChange } from './safety/index.ts';
