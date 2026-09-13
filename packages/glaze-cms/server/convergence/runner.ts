/**
 * Convergence-at-boot for *user content* — the developer origin. Reads the Drizzle schema declared in
 * `glaze.config.ts` and evolves the live database to match it before the server accepts traffic, using
 * the convergence engine's interactive resolver for any rename/create/data-loss decision. Runs after
 * the internal auth tables are materialized (internals first, then user content).
 *
 * Fails **closed**: any decision the resolver declines (always, when boot isn't an interactive
 * terminal) blocks startup with an actionable error rather than losing data or hanging.
 */

import {
	converge,
	createInteractiveResolver,
	describeChange,
	describeOperation,
	readSnapshotChain,
	statementsSince,
} from '#convergence';

import {
	buildApprovalSchema,
	createTrailId,
	findOpenRequests,
	recordEvent,
} from '../approvals/index.ts';
import { checkTargets, reconcileOpenRequest } from './reconcile.ts';

import type {
	ConvergeResult,
	InteractiveResolver,
	SnapshotChain,
	UnsafeChange,
} from '#convergence';
import type { Logger } from '#logger';
import type { GlazeContext } from '../app/context.ts';
import type { ApprovalDb, OpenRequest } from '../approvals/index.ts';
import type { TargetState, WitnessContext } from './reconcile.ts';
import type { Table } from 'drizzle-orm';

/** The results a person at a terminal could have answered differently. */
const DECIDABLE_AT_TERMINAL: ReadonlySet<ConvergeResult['status']> = new Set([
	'rejected',
	'data_loss_declined',
	'drop_declined',
	'unclassified_change',
]);

/** Guidance appended to a blocked-boot error that a person could have decided — how to unblock it. */
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
		const unmeasured = result.findings.every((finding) => finding.code === 'could_not_verify');
		return unmeasured
			? `a change could not be measured against the database (${listChanges(result.findings)}); ` +
					'if it was already applied by hand, put the column or table back so the database matches ' +
					'the snapshot again — Glaze cannot yet move the snapshot to meet the database'
			: `a change is unsafe against existing data (${listChanges(result.findings)})`;
	}
	if (result.status === 'drop_declined') {
		return `a destructive change was declined (${listChanges(result.findings)})`;
	}
	if (result.status === 'unclassified_change') {
		return (
			'Glaze cannot tell whether a change destroys data ' +
			`(${result.operations.map(describeOperation).join('; ')}); ` +
			'confirm it at a terminal, or turn on `audit` to decide it on the admin screen'
		);
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
 * Describes each unsafe finding for a message, with the database's own words when a measurement
 * could not be taken.
 *
 * @param findings - The data-loss findings.
 * @returns A semicolon-separated list.
 */
function listChanges(
	findings: readonly {
		readonly change: UnsafeChange;
		readonly code: string;
		readonly detail?: string;
	}[],
): string {
	return findings
		.map((finding) =>
			finding.code === 'could_not_verify' && finding.detail
				? `${describeChange(finding.change)}: ${finding.detail}`
				: describeChange(finding.change),
		)
		.join('; ');
}

/**
 * Acts on a convergence result: logs the applied/no-op/pending outcomes, or throws an actionable
 * error (failing boot closed) for any state that could not proceed.
 *
 * @param logger - The structured logger.
 * @param result - The convergence result.
 * @param alreadyOnFile - Whether a pending change was already on file before this boot.
 * @throws {Error} When convergence was blocked (declined, unsafe, or errored).
 */
function reportConvergence(logger: Logger, result: ConvergeResult, alreadyOnFile: boolean): void {
	switch (result.status) {
		case 'no_changes':
			return;
		case 'applied':
			logger.info(`Glaze converged the schema (${result.statements.length} statement(s)).`);
			return;
		case 'pending': {
			// A pending change means the database does NOT yet match the schema. The change is on file as
			// a pending approval, but nothing applies until a person decides — warn (not info) so the gap
			// between schema and database stays visible rather than silently normal.
			const why = [
				...result.findings.map((finding) => describeChange(finding.change)),
				...result.unclassified.map((operation) => `${describeOperation(operation)} (unclassified)`),
			];
			logger.warn(
				`${alreadyOnFile ? 'A schema change is still pending' : 'Glaze filed a pending schema change'} ` +
					`(${why.join('; ')}); the database does not yet match the schema until a person decides it.`,
			);
			return;
		}
		default: {
			const reason = blockedReason(result);
			logger.error(`Glaze could not converge the schema: ${reason}`);
			// Only a decision somebody declined can be taken at a terminal; a refusal or an error cannot.
			const decidable = DECIDABLE_AT_TERMINAL.has(result.status);
			throw new Error(`Convergence blocked: ${reason}.${decidable ? ` ${REMEDIATION}` : ''}`);
		}
	}
}

/**
 * Records what boot found, against the pending-approvals trail. Runs only when the project audits;
 * without it, `converge` never returns `pending` and there is nothing to file.
 *
 * A request already on file is reconciled from facts, never assumed (`./reconcile.ts`): the snapshot
 * chain as it stood before this boot says what was generated since the request was filed, the live
 * database says whether what the request would drop is still there, and this boot's result says what
 * happened just now. `applied` when the change is in effect — done elsewhere, or here because nothing
 * was left to decide; `superseded` when a new request replaces it; `withdrawn` when the schema no
 * longer carries it. When the facts cannot say, the request stays open and the reason is logged at
 * error level — a trail that admits it does not know beats one that guesses. A `pending` change not
 * already on file is then filed, whatever became of the older ones.
 *
 * @param context - The Glaze context (database handle, resolved config, logger).
 * @param result - What convergence just found.
 * @param chainBefore - The snapshot chain as read before convergence ran.
 * @returns Resolves once the trail reflects this boot.
 */
async function recordApprovalOutcome(
	context: GlazeContext,
	result: ConvergeResult,
	before: BootWitness,
): Promise<boolean> {
	const { db, config, logger } = context;
	const out = config.migrations.path;
	const schema = buildApprovalSchema(config.dialect);
	const events = schema.approvalEvents as Table;
	const query = (sql: string) => db.raw(sql);

	// Every open request is reconciled, not only the newest: one left open because nothing could tell
	// what happened to it must not hide the ones filed after it. The database is read again now, so
	// what this boot did can be told apart from what was already so.
	const decided = await Promise.all(
		before.open.map(async (request) => ({
			request,
			decision: reconcileOpenRequest(request, result, out, before.chain, {
				before: before.targets.get(request.requestId) ?? 'undetermined',
				after: await checkTargets(
					query,
					config.dialect,
					request,
					renamesOnPath(out, before.chain, request),
				),
			}),
		})),
	);

	// Write in one transaction, and only for requests still open when it starts: two instances booting
	// together must not both close the same request. It goes through the seam rather than the ORM,
	// whose transaction is a no-op on SQLite.
	let alreadyOnFile = false;
	await db.queryTransaction(async (tx) => {
		const trail = tx as ApprovalDb;
		const stillOpen = await findOpenRequests(trail, events);
		const openIds = new Set(stillOpen.map((request) => request.requestId));

		for (const { request, decision } of decided) {
			if (!openIds.has(request.requestId)) continue;
			if (decision.outcome === 'unknown') {
				logger.error(
					`Glaze cannot tell what happened to pending approval ${request.requestId}: ${decision.reason}. ` +
						'It stays open until somebody decides it.',
				);
			}
			if (decision.outcome === 'record') {
				const { type, payload } = decision.event;
				logger.info(
					`Glaze recorded pending approval ${request.requestId} as ${type}${describeEvent(payload)}.`,
				);
				// oxlint-disable-next-line no-await-in-loop
				await recordEvent(trail, events, {
					requestId: request.requestId,
					type,
					actorKind: 'system',
					...(payload ? { payload } : {}),
				});
			}
		}

		// A pending change is filed unless it is already on file — under its own hash, whoever filed it.
		if (result.status !== 'pending') return;
		alreadyOnFile = stillOpen.some((request) => request.changeHash === result.changeHash);
		if (alreadyOnFile) return;
		await recordEvent(trail, events, {
			requestId: createTrailId(),
			type: 'requested',
			changeHash: result.changeHash,
			actorKind: 'system',
			payload: {
				origin: 'dev',
				parentSnapshotId: result.parentSnapshotId,
				statements: result.statements,
				findings: result.findings,
				unclassified: result.unclassified,
				description: [
					...result.findings.map((finding) => describeChange(finding.change)),
					...result.unclassified.map(describeOperation),
				],
			},
		});
	});
	return alreadyOnFile;
}

/** What boot reads before it converges: the open requests, the chain, and the database's word. */
interface BootWitness {
	readonly open: readonly OpenRequest[];
	readonly chain: SnapshotChain;
	/** The target state of each open request, by request id, as it stood before this boot. */
	readonly targets: ReadonlyMap<string, TargetState>;
}

/**
 * Reads what reconciliation needs **before** convergence runs, so what others did since a request was
 * filed can be told apart from what this boot does.
 *
 * @param context - The Glaze context.
 * @returns The open requests, the chain, and the database's word on each request's targets.
 */
async function readBootWitness(context: GlazeContext): Promise<BootWitness> {
	const { db, config } = context;
	const out = config.migrations.path;
	const chain = readSnapshotChain(out);
	const events = buildApprovalSchema(config.dialect).approvalEvents as Table;
	const open = await findOpenRequests(db.db as ApprovalDb, events);
	const states = await Promise.all(
		open.map((request) =>
			checkTargets(
				(sql) => db.raw(sql),
				config.dialect,
				request,
				renamesOnPath(out, chain, request),
			),
		),
	);
	const targets = new Map(
		open.map((request, index) => [request.requestId, states[index] as TargetState]),
	);
	return { open, chain, targets };
}

/**
 * Whether anything was renamed between a request's snapshot and the head of the chain. A rename on
 * the way means an absent target may have been moved rather than dropped, so the witness must not
 * call it gone.
 *
 * @param out - The migration output directory.
 * @param chain - The chain.
 * @param request - The open request.
 * @returns The witness context.
 */
function renamesOnPath(out: string, chain: SnapshotChain, request: OpenRequest): WitnessContext {
	const payload = request.payload as { parentSnapshotId?: unknown } | null;
	const parent = typeof payload?.parentSnapshotId === 'string' ? payload.parentSnapshotId : null;
	if (parent === null || chain.head === null || chain.head.id === parent) {
		return { renamedOnPath: false };
	}
	const statements = statementsSince(out, chain, parent);
	// An unreadable path is reported as unknown lineage by the walk; nothing to add here.
	return { renamedOnPath: statements?.some((statement) => /\brename\b/i.test(statement)) ?? false };
}

/**
 * Says what an appended event carries, for the log line.
 *
 * @param payload - The event payload.
 * @returns A parenthesised note, or nothing.
 */
function describeEvent(payload: Record<string, unknown> | undefined): string {
	if (!payload) return '';
	const notes = Object.entries(payload).map(([key, value]) => `${key}: ${String(value)}`);
	return notes.length > 0 ? ` (${notes.join(', ')})` : '';
}

/**
 * Converges the live database to the developer's Drizzle schema at boot. A no-op when the config
 * declares no `schema`. An additive change applies either way. One that needs a person is asked at
 * the terminal (in a TTY) without `audit`, and filed as a pending approval with it. Any
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

	// Read before converging, so what happened since a request was filed can be told apart from what
	// this boot does.
	const before = config.workflow.audit ? await readBootWitness(context) : null;

	const { resolve, confirmLoss, confirmDrop, confirmUnclassified } = resolver;
	const result = await converge({
		db,
		dialect: config.dialect,
		schema: config.schema,
		out: config.migrations.path,
		resolve,
		confirmLoss,
		confirmDrop,
		confirmUnclassified,
		audit: config.workflow.audit,
	});

	const alreadyOnFile = before ? await recordApprovalOutcome(context, result, before) : false;

	reportConvergence(logger, result, alreadyOnFile);
}
