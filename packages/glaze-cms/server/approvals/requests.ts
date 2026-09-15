/**
 * Reading what an open request describes back out of its recorded payload.
 */

import type { Operation, RecordedDecision, UnsafeChange } from '#convergence';
import type { OpenRequest } from './store.ts';

/** The shape of a recorded finding, as far as this reads it. */
interface RecordedFinding {
	readonly change?: unknown;
}

/**
 * The measured changes a request was filed for, read defensively out of its recorded findings.
 *
 * @param open - The open request.
 * @returns The changes, in the order they were measured.
 */
export function changesOf(open: OpenRequest): UnsafeChange[] {
	const payload = open.payload as { findings?: unknown } | null;
	const findings = Array.isArray(payload?.findings) ? (payload.findings as RecordedFinding[]) : [];
	return findings
		.map((finding) => finding?.change)
		.filter(
			(change): change is UnsafeChange =>
				change !== null &&
				typeof change === 'object' &&
				typeof (change as UnsafeChange).kind === 'string',
		);
}

/**
 * Whether a request carries operations the classifier had no rule for.
 *
 * @param open - The open request.
 * @returns `true` when the request has unclassified operations.
 */
export function hasUnclassified(open: OpenRequest): boolean {
	const payload = open.payload as { unclassified?: unknown } | null;
	return Array.isArray(payload?.unclassified) && payload.unclassified.length > 0;
}

/**
 * The operations a request carries that the classifier had no rule for.
 *
 * @param open - The open request.
 * @returns The unclassified operations, as recorded.
 */
export function unclassifiedOf(open: OpenRequest): Operation[] {
	const payload = open.payload as { unclassified?: unknown } | null;
	return Array.isArray(payload?.unclassified) ? (payload.unclassified as Operation[]) : [];
}

/**
 * The questions drizzle asked when the request was filed, and how they were answered.
 *
 * @param open - The open request.
 * @returns The recorded decisions; empty for a request filed before they were recorded.
 */
export function decisionsOf(open: OpenRequest): RecordedDecision[] {
	const payload = open.payload as { decisions?: unknown } | null;
	return Array.isArray(payload?.decisions) ? (payload.decisions as RecordedDecision[]) : [];
}

/**
 * The migration statements the request was filed with.
 *
 * @param open - The open request.
 * @returns The statements, in order.
 */
export function statementsOf(open: OpenRequest): string[] {
	const payload = open.payload as { statements?: unknown } | null;
	return Array.isArray(payload?.statements)
		? payload.statements.filter((statement): statement is string => typeof statement === 'string')
		: [];
}

/**
 * The one-line descriptions the request was filed with.
 *
 * @param open - The open request.
 * @returns The description lines.
 */
export function descriptionOf(open: OpenRequest): string[] {
	const payload = open.payload as { description?: unknown } | null;
	return Array.isArray(payload?.description)
		? payload.description.filter((line): line is string => typeof line === 'string')
		: [];
}
