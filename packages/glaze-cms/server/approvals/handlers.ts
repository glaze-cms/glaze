/**
 * What approving and rejecting actually do, kept apart from the Elysia wiring so the decisions are
 * testable without a request.
 *
 * Approving runs convergence **twice**, and the first pass is the point. `audit: true` regenerates
 * the migration, probes the live database and rolls the migration back, handing back the change's
 * fingerprint and the row counts as they are *now* — without applying anything. Only when both still
 * match what the request recorded does the second pass apply. That is what stops somebody who
 * approved "this drops 12 rows" from applying "this drops 40,000".
 */

import { converge } from '#convergence';

import { recordEvent } from './store.ts';

import type { ConvergeResult, DataLossFinding, InteractiveResolver } from '#convergence';
import type { GlazeContext } from '../app/context.ts';
import type { ApprovalDb, OpenRequest } from './store.ts';
import type { Table } from 'drizzle-orm';

/** What the `requested` payload carries, as much of it as deciding needs. */
export interface RequestedPayload {
	readonly origin?: string;
	readonly statements?: readonly string[];
	readonly findings?: readonly DataLossFinding[];
}

/** Why an approval could not go ahead, or that it did. */
export type ApprovalOutcome =
	| { readonly status: 'applied'; readonly statements: readonly string[] }
	| { readonly status: 'apply_failed'; readonly detail: string }
	| { readonly status: 'superseded'; readonly changeHash: string }
	| { readonly status: 'findings_moved'; readonly findings: readonly DataLossFinding[] }
	| { readonly status: 'nothing_to_apply' }
	| { readonly status: 'error'; readonly detail: string };

/**
 * The seams an approval answers with. A person has already been shown the counts and agreed, so the
 * confirmers say yes — that is the whole mechanical meaning of an approval. `resolve` still answers
 * `create` for a rename-or-create question, because a handler has nobody to ask; a change carrying
 * one cannot survive the fingerprint check anyway, and is refused rather than guessed at.
 */
const APPROVED: InteractiveResolver = {
	resolve: async () => ({ action: 'create' }),
	confirmLoss: () => true,
	confirmDrop: () => true,
};

/**
 * Renders findings in a form two sets can be compared by: code, table, column and affected rows —
 * the things a person was shown. Order is not significant, so it is sorted away.
 *
 * @param findings - The findings to render.
 * @returns A canonical string, equal for equal consequences.
 */
function canonicalFindings(findings: readonly DataLossFinding[]): string {
	return findings
		.map((f) => `${f.code} ${f.change.table} ${f.change.column} ${f.affectedRows}`)
		.toSorted()
		.join('');
}

/**
 * Reads the statements and findings a request recorded, tolerating a payload shape it does not
 * recognise rather than throwing — an unreadable payload means the request cannot be approved, which
 * the caller decides, not this.
 *
 * @param payload - The `requested` event's payload.
 * @returns The recorded statements and findings.
 */
export function readRequestedPayload(payload: unknown): RequestedPayload {
	return payload !== null && typeof payload === 'object' ? payload : {};
}

/**
 * Approves an open request: verifies the change is still the one that was approved, then applies it.
 *
 * @param context - The Glaze context (database handle, resolved config).
 * @param request - The open request being approved.
 * @returns What happened, for the caller to map to a status code and to the trail.
 */
export async function applyApprovedChange(
	context: GlazeContext,
	request: OpenRequest,
): Promise<ApprovalOutcome> {
	const { config } = context;
	if (!config.schema) return { status: 'nothing_to_apply' };

	const options = {
		db: context.db,
		dialect: config.dialect,
		schema: config.schema,
		out: config.migrations.path,
		...APPROVED,
	};

	// Pass one: regenerate and probe, applying nothing. `audit` is what makes this a dry run.
	const verified = await converge({ ...options, audit: true });
	if (verified.status === 'no_changes') return { status: 'nothing_to_apply' };
	if (verified.status !== 'pending') return { status: 'error', detail: describe(verified) };

	if (verified.changeHash !== request.changeHash) {
		return { status: 'superseded', changeHash: verified.changeHash };
	}

	const recorded = readRequestedPayload(request.payload).findings ?? [];
	if (canonicalFindings(recorded) !== canonicalFindings(verified.findings)) {
		return { status: 'findings_moved', findings: verified.findings };
	}

	// Pass two: the same change, now applied.
	const applied = await converge(options);
	if (applied.status === 'applied') {
		return { status: 'applied', statements: applied.statements };
	}
	return { status: 'apply_failed', detail: describe(applied) };
}

/**
 * Summarises a convergence result that is not the one we wanted, for the trail and for the operator.
 *
 * @param result - The unexpected result.
 * @returns A short description.
 */
function describe(result: ConvergeResult): string {
	if (result.status === 'error')
		return result.detail ? `${result.code}: ${result.detail}` : result.code;
	if (result.status === 'unsafe_change') {
		return `unsafe: ${result.findings.map((f) => `${f.change.table}.${f.change.column}`).join(', ')}`;
	}
	return result.status;
}

/**
 * Appends the events an approval produces, in one transaction so a decision and its result cannot
 * half-happen.
 *
 * @param db - The query builder.
 * @param events - The `approval_events` table.
 * @param requestId - The request being decided.
 * @param actorId - The account that decided.
 * @param outcome - What applying produced.
 * @returns Resolves once the trail reflects the decision.
 */
export async function recordApproval(
	db: ApprovalDb,
	events: Table,
	requestId: string,
	actorId: string,
	outcome: ApprovalOutcome,
): Promise<void> {
	await db.transaction(async (tx) => {
		if (outcome.status === 'superseded') {
			await recordEvent(tx, events, {
				requestId,
				type: 'superseded',
				actorKind: 'system',
				payload: { supersededBy: outcome.changeHash },
			});
			return;
		}

		await recordEvent(tx, events, { requestId, type: 'approved', actorId, actorKind: 'user' });

		if (outcome.status === 'applied') {
			await recordEvent(tx, events, {
				requestId,
				type: 'applied',
				actorId,
				actorKind: 'user',
				payload: { statements: outcome.statements },
			});
			return;
		}
		if (outcome.status === 'apply_failed') {
			await recordEvent(tx, events, {
				requestId,
				type: 'apply_failed',
				actorId,
				actorKind: 'user',
				payload: { detail: outcome.detail },
			});
		}
	});
}
