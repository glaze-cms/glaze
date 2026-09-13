export { applyMigration, captureRowCounts, findUnexpectedLosses } from './apply/index.ts';
export { classifyChange, describeChange, describeOperation } from './classifier/index.ts';
export {
	computeChangeHash,
	findMigrationByHash,
	linkHash,
	readMigrationStatements,
	readParentSnapshotId,
	readSnapshotChain,
	statementsSince,
} from './orchestrator/index.ts';
export {
	CONVERGENCE_ERROR_CODES,
	decodeEnvelope,
	toConvergenceErrorCode,
} from './envelope/index.ts';
export { createInteractiveResolver } from './interactive/index.ts';
export { converge, createGenerateCompute, resolveWithDecisions } from './orchestrator/index.ts';
export {
	checkColumnHasData,
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
export type { Classification, Operation, Renames } from './classifier/index.ts';
export type {
	ConvergenceErrorCode,
	DataLossReason,
	OperationResult,
	SchemaDecision,
} from './envelope/index.ts';
export type { InteractiveResolver, ResolverIo } from './interactive/index.ts';
export type {
	ChainLink,
	ChainSearch,
	ConvergeOptions,
	ConvergeResult,
	DecisionResolution,
	DropConfirmer,
	EnvelopeCompute,
	Hint,
	LossResolver,
	ResolvedOutcome,
	Resolver,
	SnapshotChain,
	UnclassifiedConfirmer,
} from './orchestrator/index.ts';
export type { DataLossCode, DataLossFinding, QueryExecutor, UnsafeChange } from './safety/index.ts';
