/**
 * Decodes drizzle-kit's raw envelope (`--output json` stdout or an SDK return value) into Glaze's
 * {@link OperationResult}. Decodes defensively from `unknown` so it is robust to rc shape drift and
 * never throws on unexpected input — an unrecognized envelope becomes a translatable `error` result.
 */

import { toConvergenceErrorCode } from './errors.ts';

import type { DataLossReason, OperationResult, SchemaDecision } from './types.ts';

/** The `confirm_data_loss` reasons drizzle emits; anything else is treated conservatively. */
const DATA_LOSS_REASONS: ReadonlySet<DataLossReason> = new Set([
	'non_empty',
	'table_recreate',
	'type_change',
]);

/**
 * Decodes a drizzle-kit envelope into a Glaze {@link OperationResult}.
 *
 * @param raw - The parsed envelope object (from CLI JSON or the SDK return value).
 * @returns The normalized result; an unrecognized shape yields an `error` with code `unknown`.
 */
export function decodeEnvelope(raw: unknown): OperationResult {
	if (!isRecord(raw) || typeof raw.status !== 'string') {
		return unrecognized('drizzle-kit envelope was not a recognized object');
	}

	switch (raw.status) {
		case 'ok':
			return decodeOk(raw);
		case 'no_changes':
			return { status: 'no_changes' };
		case 'missing_hints':
			return { status: 'needs_decision', decisions: decodeDecisions(raw.unresolved) };
		case 'error':
			return decodeError(raw.error);
		default:
			return unrecognized(`unknown drizzle-kit status: ${raw.status}`);
	}
}

/**
 * Decodes an `ok` envelope, carrying any emitted statements and migration path.
 *
 * @param raw - The `ok` envelope record.
 * @returns An `ok` {@link OperationResult}.
 */
function decodeOk(raw: Record<string, unknown>): OperationResult {
	const statements = asStringArray(raw.statements);
	return typeof raw.migration_path === 'string'
		? { status: 'ok', statements, migrationPath: raw.migration_path }
		: { status: 'ok', statements };
}

/**
 * Decodes the `unresolved` array of a `missing_hints` envelope into schema decisions.
 *
 * @param unresolved - The raw `unresolved` value.
 * @returns The decoded decisions (unparseable items are skipped).
 */
function decodeDecisions(unresolved: unknown): SchemaDecision[] {
	if (!Array.isArray(unresolved)) return [];

	const decisions: SchemaDecision[] = [];
	for (const item of unresolved) {
		const decision = decodeDecision(item);
		if (decision !== null) decisions.push(decision);
	}
	return decisions;
}

/**
 * Decodes one `missing_hints` item into a {@link SchemaDecision}.
 *
 * @param item - The raw unresolved item.
 * @returns The decision, or `null` when the item is not a recognized decision.
 */
function decodeDecision(item: unknown): SchemaDecision | null {
	if (!isRecord(item) || typeof item.kind !== 'string') return null;

	const entityKind = item.kind;
	const entity = asStringArray(item.entity);

	if (item.type === 'rename_or_create') {
		return { type: 'rename_or_create', entityKind, entity };
	}

	if (item.type === 'confirm_data_loss') {
		const reason = asDataLossReason(item.reason);
		const details = asReasonDetails(item.reason_details);
		return details === null
			? { type: 'confirm_data_loss', entityKind, entity, reason }
			: { type: 'confirm_data_loss', entityKind, entity, reason, reasonDetails: details };
	}

	return null;
}

/**
 * Decodes an `error` envelope's `error` object into a translatable Glaze error result.
 *
 * @param error - The raw `error` value.
 * @returns An `error` {@link OperationResult}.
 */
function decodeError(error: unknown): OperationResult {
	if (!isRecord(error) || typeof error.code !== 'string') {
		return unrecognized('drizzle-kit error envelope had no code');
	}

	const rawCode = error.code;
	const base = { status: 'error', code: toConvergenceErrorCode(rawCode), rawCode } as const;
	return typeof error.message === 'string' ? { ...base, detail: error.message } : base;
}

/**
 * Builds a fallback `error` result for an unrecognized envelope.
 *
 * @param detail - A diagnostic describing what was unrecognized.
 * @returns An `error` {@link OperationResult} with code `unknown`.
 */
function unrecognized(detail: string): OperationResult {
	return { status: 'error', code: 'unknown', rawCode: '', detail };
}

/**
 * Coerces a value to a known {@link DataLossReason}, defaulting unknown reasons to `non_empty` (the
 * conservative "data will be lost" interpretation).
 *
 * @param value - The raw reason.
 * @returns A {@link DataLossReason}.
 */
function asDataLossReason(value: unknown): DataLossReason {
	return typeof value === 'string' && DATA_LOSS_REASONS.has(value as DataLossReason)
		? (value as DataLossReason)
		: 'non_empty';
}

/**
 * Extracts `{ from, to }` type-change details when present and well-formed.
 *
 * @param value - The raw `reason_details`.
 * @returns The details, or `null`.
 */
function asReasonDetails(value: unknown): { from: string; to: string } | null {
	if (isRecord(value) && typeof value.from === 'string' && typeof value.to === 'string') {
		return { from: value.from, to: value.to };
	}
	return null;
}

/**
 * Reports whether a value is a non-null, non-array object.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is a plain record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerces a value to a string array, keeping only string elements; non-arrays yield `[]`.
 *
 * @param value - The candidate.
 * @returns A string array.
 */
function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}
