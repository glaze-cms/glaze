/**
 * Decodes drizzle-kit's raw envelope (`--output json` stdout or an SDK return value) into Glaze's
 * {@link OperationResult}. Decodes defensively from `unknown` so it is robust to rc shape drift and
 * never throws on unexpected input.
 *
 * It **fails closed**: content it cannot decode becomes a translatable `error`, never a silently
 * dropped or empty result. In particular a `missing_hints` envelope whose decisions can't be decoded
 * (an unrecognized decision type on a future rc, a malformed item) yields `invalid_hints` — a real
 * decision drizzle is blocking on can never silently disappear. It also preserves load-bearing data
 * (export/explain `warnings`, the full error `meta` incl. `check_error` conflict branches and
 * `query_error` sql) rather than discarding it.
 */

import { toConvergenceErrorCode } from './errors.ts';

import type { DataLossReason, OperationResult, SchemaDecision } from './types.ts';

/** The `confirm_data_loss` reasons drizzle emits; anything else decodes to `'unknown'` (honestly). */
const DATA_LOSS_REASONS: ReadonlySet<DataLossReason> = new Set([
	'non_empty',
	'table_recreate',
	'type_change',
]);

/**
 * Decodes a drizzle-kit envelope into a Glaze {@link OperationResult}.
 *
 * @param raw - The parsed envelope object (from CLI JSON or the SDK return value).
 * @returns The normalized result; an unrecognized shape yields an `error`.
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
			return decodeMissingHints(raw.unresolved);
		case 'error':
			return decodeError(raw.error);
		default:
			return unrecognized(`unknown drizzle-kit status: ${raw.status}`);
	}
}

/**
 * Decodes an `ok` envelope, carrying emitted statements, migration path, and destructive-preview
 * warnings when present.
 *
 * @param raw - The `ok` envelope record.
 * @returns An `ok` {@link OperationResult}.
 */
function decodeOk(raw: Record<string, unknown>): OperationResult {
	const statements = asStringArray(raw.statements);
	const warnings = asStringArray(raw.warnings);

	const base = { status: 'ok', statements } as const;
	const withPath =
		typeof raw.migration_path === 'string' ? { ...base, migrationPath: raw.migration_path } : base;
	return warnings.length > 0 ? { ...withPath, warnings } : withPath;
}

/**
 * Decodes the `unresolved` array of a `missing_hints` envelope. Fails closed: a non-array, an empty
 * list, or any item that can't be decoded yields an `invalid_hints` error carrying the offending
 * content — a decision is never dropped.
 *
 * @param unresolved - The raw `unresolved` value.
 * @returns `needs_decision` with the decoded decisions, or an `invalid_hints` error.
 */
function decodeMissingHints(unresolved: unknown): OperationResult {
	if (!Array.isArray(unresolved) || unresolved.length === 0) {
		return invalidHints('missing_hints envelope carried no decodable decisions', { unresolved });
	}

	const decisions: SchemaDecision[] = [];
	for (const item of unresolved) {
		const decision = decodeDecision(item);
		if (decision === null) {
			return invalidHints('missing_hints contained an unrecognized decision', { item });
		}
		decisions.push(decision);
	}

	return { status: 'needs_decision', decisions };
}

/**
 * Decodes one `missing_hints` item into a {@link SchemaDecision}.
 *
 * @param item - The raw unresolved item.
 * @returns The decision, or `null` when the item is not a recognized, well-formed decision.
 */
function decodeDecision(item: unknown): SchemaDecision | null {
	if (!isRecord(item) || typeof item.kind !== 'string') return null;

	const entity = decodeEntity(item.entity);
	if (entity === null) return null;
	const entityKind = item.kind;

	if (item.type === 'rename_or_create') {
		return { type: 'rename_or_create', entityKind, entity };
	}

	if (item.type === 'confirm_data_loss') {
		const reason = asDataLossReason(item.reason);
		if (reason === 'type_change') {
			const details = asReasonDetails(item.reason_details);
			return details === null
				? { type: 'confirm_data_loss', entityKind, entity, reason }
				: { type: 'confirm_data_loss', entityKind, entity, reason, reasonDetails: details };
		}
		return { type: 'confirm_data_loss', entityKind, entity, reason };
	}

	return null;
}

/**
 * Decodes an `error` envelope's `error` object, preserving its remaining fields as `meta`.
 *
 * @param error - The raw `error` value.
 * @returns An `error` {@link OperationResult}.
 */
function decodeError(error: unknown): OperationResult {
	if (!isRecord(error) || typeof error.code !== 'string') {
		return unrecognized('drizzle-kit error envelope had no code');
	}

	const rawCode = error.code;
	const code = toConvergenceErrorCode(rawCode);
	const detail = typeof error.message === 'string' ? error.message : undefined;
	const meta = extractMeta(error);

	const withDetail =
		detail === undefined
			? ({ status: 'error', code, rawCode } as const)
			: ({ status: 'error', code, rawCode, detail } as const);
	return meta === undefined ? withDetail : { ...withDetail, meta };
}

/**
 * Builds an `invalid_hints` error for undecodable decision content, carrying the offending value.
 *
 * @param detail - A diagnostic message.
 * @param meta - The offending content (for logs / debugging).
 * @returns An `error` {@link OperationResult}.
 */
function invalidHints(detail: string, meta: Record<string, unknown>): OperationResult {
	return { status: 'error', code: 'invalid_hints', rawCode: '', detail, meta };
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
 * Copies an error object's fields except `code`/`message` into a `meta` record, or `undefined` when
 * there is nothing left.
 *
 * @param error - The raw error record.
 * @returns The remaining fields, or `undefined`.
 */
function extractMeta(error: Record<string, unknown>): Record<string, unknown> | undefined {
	const meta: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(error)) {
		if (key !== 'code' && key !== 'message') meta[key] = value;
	}
	return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Coerces a value to a known {@link DataLossReason}, or `'unknown'` — never relabeled as a known
 * reason, so the approver is never shown a false explanation for a destructive change.
 *
 * @param value - The raw reason.
 * @returns A {@link DataLossReason} or `'unknown'`.
 */
function asDataLossReason(value: unknown): DataLossReason | 'unknown' {
	return typeof value === 'string' && DATA_LOSS_REASONS.has(value as DataLossReason)
		? (value as DataLossReason)
		: 'unknown';
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
 * Decodes an entity identifier tuple, requiring a non-empty array of strings. Returns `null` for
 * anything else — the tuple is load-bearing (it targets a hint), so a malformed one fails the
 * decision rather than being silently truncated.
 *
 * @param value - The raw `entity` value.
 * @returns The string tuple, or `null` when malformed.
 */
function decodeEntity(value: unknown): readonly string[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	return value.every((element): element is string => typeof element === 'string') ? value : null;
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
