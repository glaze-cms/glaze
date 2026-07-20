export { applyMigration, captureRowCounts, findUnexpectedLosses } from './apply/index.ts';
export {
	CONVERGENCE_ERROR_CODES,
	decodeEnvelope,
	toConvergenceErrorCode,
} from './envelope/index.ts';
export { resolveWithDecisions } from './orchestrator/index.ts';
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
export type {
	ConvergenceErrorCode,
	DataLossReason,
	OperationResult,
	SchemaDecision,
} from './envelope/index.ts';
export type {
	DecisionResolution,
	EnvelopeCompute,
	Hint,
	ResolvedOutcome,
	Resolver,
} from './orchestrator/index.ts';
export type { DataLossCode, DataLossFinding, QueryExecutor, UnsafeChange } from './safety/index.ts';
