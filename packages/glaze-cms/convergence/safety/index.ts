export {
	checkColumnHasData,
	checkTableHasRows,
	checkColumnLengthOverflow,
	checkNotNullColumnOnNonEmpty,
	checkNotNullOnExistingNulls,
	checkUniqueOnDuplicates,
} from './checks.ts';
export { detectDataLoss } from './detector.ts';
export { DATA_LOSS_CODES } from './types.ts';

export type { DataLossCode, DataLossFinding, QueryExecutor, UnsafeChange } from './types.ts';
