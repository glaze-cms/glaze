/**
 * Reading what an open request describes back out of its recorded payload.
 */

import type { UnsafeChange } from '#convergence';
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
