/**
 * Ids for the approvals trail.
 *
 * The trail is append-only and its whole meaning depends on order: a request is open when its
 * **latest** event is `requested`. Ordering by `created_at` cannot answer that — a request filed and
 * superseded in the same millisecond is an ordinary boot, not a corner case, and rows with equal
 * timestamps leave the planner to decide which came last. Read the wrong way round, a closed request
 * looks open forever.
 *
 * So the id carries the order itself. Every part is fixed width, because lexicographic comparison is
 * what the database sorts on and `9` sorts after `10` unless both are padded:
 *
 * - a millisecond prefix, never allowed to go backwards even if the system clock does;
 * - a counter, so events written in the same millisecond by this process still have an order;
 * - a random suffix, so two processes writing in the same millisecond do not collide.
 *
 * Between processes the millisecond still decides, and a tie there is unordered. That is acceptable:
 * concurrent writers appending to the *same* request in the same millisecond is what the approval
 * hash check is for, not what ordering can fix.
 */

import { randomUUID } from 'node:crypto';

/**
 * Width of the base-36 millisecond prefix. Ten characters is wide enough until the year 5138, and
 * fixed width is the point.
 */
const TIMESTAMP_WIDTH = 10;

/**
 * Width of the base-36 per-process counter. Six characters covers 2.1 billion events before it would
 * wrap — far past the lifetime of a process that appends a handful of rows per boot.
 */
const SEQUENCE_WIDTH = 6;

/** The last millisecond handed out, so a clock that steps backwards cannot reorder the trail. */
let lastTimestamp = 0;

/** Distinguishes events this process writes within one millisecond. */
let sequence = 0;

/**
 * Creates a time-ordered, unique id for a trail row — an event, or the request that groups them.
 *
 * @param now - The instant to encode, for tests that need a fixed one.
 * @returns An id that sorts chronologically among the ids this process has handed out.
 */
export function createTrailId(now: number = Date.now()): string {
	lastTimestamp = Math.max(lastTimestamp, now);
	const stamp = lastTimestamp.toString(36).padStart(TIMESTAMP_WIDTH, '0');
	const seq = (sequence++).toString(36).padStart(SEQUENCE_WIDTH, '0');
	return `${stamp}-${seq}-${randomUUID()}`;
}
