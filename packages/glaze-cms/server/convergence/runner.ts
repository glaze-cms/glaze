/**
 * Convergence-at-boot for *user content* — the developer origin. Reads the Drizzle schema declared in
 * `glaze.config.ts` and evolves the live database to match it before the server accepts traffic, using
 * the convergence engine's interactive resolver for any rename/create/data-loss decision. Runs after
 * the internal auth tables are materialized (internals first, then user content).
 *
 * Fails **closed**: any decision the resolver declines (always, when boot isn't an interactive
 * terminal) blocks startup with an actionable error rather than losing data or hanging.
 */

import { converge, createInteractiveResolver } from '#convergence';

import {
	buildApprovalSchema,
	createTrailId,
	findOpenRequest,
	recordEvent,
} from '../approvals/index.ts';

import type { ConvergeResult, InteractiveResolver } from '#convergence';
import type { Logger } from '#logger';
import type { GlazeContext } from '../app/context.ts';
import type { ApprovalDb } from '../approvals/index.ts';
import type { Table } from 'drizzle-orm';

/** Guidance appended to every blocked-boot error — how the developer unblocks it. */
const REMEDIATION =
	'Run Glaze in an interactive terminal to resolve it, or reconcile the schema change manually.';

/**
 * Summarizes a blocked convergence result in one operator-facing line — which change could not
 * proceed and why. Only the terminal states that block boot reach here.
 *
 * @param result - A convergence result that is neither applied, no-op, nor pending.
 * @returns A short human-readable reason.
 */
function blockedReason(
	result: Exclude<ConvergeResult, { status: 'applied' | 'no_changes' | 'pending' }>,
): string {
	if (result.status === 'rejected') {
		return `a schema change was declined (${result.decision.target.join('.')})`;
	}
	if (result.status === 'data_loss_declined') {
		return `a data-loss change was declined for ${listTables(result.losses)}`;
	}
	if (result.status === 'unexpected_data_loss') {
		return `the migration would drop data from ${listTables(result.losses)} and was rolled back`;
	}
	if (result.status === 'unsafe_change') {
		return `a change is unsafe against existing data (${listChanges(result.findings)})`;
	}
	return result.detail ? `${result.code}: ${result.detail}` : result.code;
}

/**
 * Joins the affected table names of a set of row losses for a message.
 *
 * @param losses - The measured row losses.
 * @returns A comma-separated list of table names.
 */
function listTables(losses: readonly { readonly table: string }[]): string {
	return losses.map((loss) => loss.table).join(', ');
}

/**
 * Joins the `table.column` of each unsafe finding for a message.
 *
 * @param findings - The data-loss findings.
 * @returns A comma-separated list of `table.column`.
 */
function listChanges(
	findings: readonly { readonly change: { readonly table: string; readonly column: string } }[],
): string {
	return findings.map((finding) => `${finding.change.table}.${finding.change.column}`).join(', ');
}

/**
 * Acts on a convergence result: logs the applied/no-op/pending outcomes, or throws an actionable
 * error (failing boot closed) for any state that could not proceed.
 *
 * @param logger - The structured logger.
 * @param result - The convergence result.
 * @throws {Error} When convergence was blocked (declined, unsafe, or errored).
 */
function reportConvergence(logger: Logger, result: ConvergeResult): void {
	switch (result.status) {
		case 'no_changes':
			return;
		case 'applied':
			logger.info(`Glaze converged the schema (${result.statements.length} statement(s)).`);
			return;
		case 'pending':
			// An audited change is held for approval, so the database does NOT yet match the schema. The
			// change is on file as a pending approval, but nothing applies until a person decides — warn
			// (not info) so the gap between schema and database stays visible rather than silently normal.
			logger.warn(
				`Glaze detected ${result.statements.length} pending schema change(s) held for approval; the ` +
					'database does not yet match the schema. Approve them in the admin to apply them.',
			);
			return;
		default: {
			const reason = blockedReason(result);
			logger.error(`Glaze could not converge the schema: ${reason}`);
			throw new Error(`Convergence blocked: ${reason}. ${REMEDIATION}`);
		}
	}
}

/**
 * Records what boot found, against the pending-approvals trail. Runs only when the project audits;
 * without it, `converge` never returns `pending` and there is nothing to file.
 *
 * Four cases, and the hash decides between them:
 *
 * - **Nothing to do, nothing on file** — silence is correct.
 * - **Nothing to do, a request on file** — the schema went back to what the database already has, so
 *   the request describes a change nobody is proposing any more: `withdrawn`.
 * - **A change matching the open request** — the same change, still waiting. Recording it again would
 *   turn one decision into a queue of identical ones.
 * - **A change that does not match** — the schema moved while the request was open. The old request is
 *   `superseded` and a new one filed, rather than repositioned onto a change its approver never saw.
 *
 * @param context - The Glaze context (database handle, resolved config).
 * @param result - What convergence just found.
 * @returns Resolves once the trail reflects this boot.
 */
async function recordApprovalOutcome(context: GlazeContext, result: ConvergeResult): Promise<void> {
	if (result.status !== 'pending' && result.status !== 'no_changes') return;

	const schema = buildApprovalSchema(context.config.dialect);
	const events = schema.approvalEvents as Table;
	const outcome = result;

	// Read and write in one transaction: closing a request and filing its successor is one decision,
	// and a crash between them would leave the trail claiming a change was superseded by nothing. It
	// goes through the seam rather than the ORM, whose transaction is a no-op on SQLite.
	await context.db.queryTransaction(async (tx) => {
		const db = tx as ApprovalDb;
		const open = await findOpenRequest(db, events);

		if (outcome.status === 'no_changes') {
			if (open) {
				await recordEvent(db, events, {
					requestId: open.requestId,
					type: 'withdrawn',
					actorKind: 'system',
				});
			}
			return;
		}

		if (open?.changeHash === outcome.changeHash) return;

		if (open) {
			await recordEvent(db, events, {
				requestId: open.requestId,
				type: 'superseded',
				actorKind: 'system',
				payload: { supersededBy: outcome.changeHash },
			});
		}

		await recordEvent(db, events, {
			requestId: createTrailId(),
			type: 'requested',
			changeHash: outcome.changeHash,
			actorKind: 'system',
			payload: { origin: 'dev', statements: outcome.statements, findings: outcome.findings },
		});
	});
}

/**
 * Converges the live database to the developer's Drizzle schema at boot. A no-op when the config
 * declares no `schema`. Without `audit` it applies a detected change, prompting (in a TTY) for any
 * rename/data-loss decision; with `audit` it holds the change for approval and applies nothing. Any
 * declined/unsafe/errored result throws, failing boot closed.
 *
 * @param context - The Glaze context (database handle, resolved config, logger).
 * @param resolver - The human seams for decisions. Defaults to the interactive terminal resolver;
 *   injected in tests (and by a future `glaze migrate` CLI) to drive decisions non-interactively.
 * @returns Resolves once the schema is converged (or skipped); rejects when convergence is blocked.
 */
export async function runConvergence(
	context: GlazeContext,
	resolver: InteractiveResolver = createInteractiveResolver(),
): Promise<void> {
	const { db, config, logger } = context;

	if (!config.schema) return;

	const { resolve, confirmLoss, confirmDrop } = resolver;
	const result = await converge({
		db,
		dialect: config.dialect,
		schema: config.schema,
		out: config.migrations.path,
		resolve,
		confirmLoss,
		confirmDrop,
		audit: config.workflow.audit,
	});

	if (config.workflow.audit) await recordApprovalOutcome(context, result);

	reportConvergence(logger, result);
}
