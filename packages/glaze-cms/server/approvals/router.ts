/**
 * The pending-approvals routes: how a person without a terminal answers a schema change that is
 * waiting on them. One list, and two decisions.
 *
 * Reading the list needs a session; deciding needs `admin`, read from the session table rather than
 * the cookie cache, so a session revoked by sign-out cannot decide. Approving runs the whole apply in the
 * handler — verify, measure again, record, apply through the oracle, record — which is the payoff of
 * the injected seams: the screen is just another caller. It holds the request open for seconds.
 * Every answer is the `{ success, data, error }` envelope.
 */

import { Elysia, NotFound, ParseError, status, ValidationError } from 'elysia';

import { createAuthMacro, resolveFreshSession } from '../auth/index.ts';
import { buildErrorResponse, buildListResponse, buildSuccessResponse } from '../responses/index.ts';
import { approveRequest } from './approve.ts';
import { measureRequest } from './measure.ts';
import { decisionsOf, descriptionOf, statementsOf, unclassifiedOf } from './requests.ts';
import { buildApprovalSchema } from './schema/index.ts';
import { findOpenRequests, findRole, recordEvent } from './store.ts';

import type { GlazeContext } from '../app/context.ts';
import type { SessionProvider } from '../auth/index.ts';
import type { ApprovalDb, OpenRequest } from './store.ts';
import type { Table } from 'drizzle-orm';

/** The path segment the approvals routes live under, beneath the API prefix. */
export const APPROVALS_ROUTE_NAME = 'pending-approvals';

/** The inputs the approvals router is composed from. */
interface ApprovalsRouterInput {
	/** The Glaze context (db handle, resolved options, logger). */
	readonly context: GlazeContext;
	/** The shared Better Auth instance backing the route gate. */
	readonly auth: SessionProvider;
}

/**
 * Reads a non-empty string field out of a JSON body.
 *
 * @param body - The parsed body.
 * @param field - The field name.
 * @returns The trimmed value, or `null` when absent or blank.
 */
function readText(body: unknown, field: string): string | null {
	if (typeof body !== 'object' || body === null) return null;
	const value = (body as Record<string, unknown>)[field];
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Builds the approvals router.
 *
 * @param input - The context and the auth instance.
 * @returns An Elysia plugin serving the pending-approvals routes.
 */
export function createApprovalsRouter({ context, auth }: ApprovalsRouterInput) {
	const { db, config, logger, options } = context;
	const base = `${options.prefixes.api}/${APPROVALS_ROUTE_NAME}`;
	const schema = buildApprovalSchema(config.dialect);
	const events = schema.approvalEvents as Table;
	const principals = schema.principals as Table;
	const trail = db.db as ApprovalDb;
	const query = (sql: string) => db.raw(sql);

	/** Presents an open request as the list shows it, with live counts. */
	const present = async (open: OpenRequest) => {
		const measured = await measureRequest(query, config.dialect, open);
		return {
			id: open.requestId,
			changeHash: open.changeHash,
			createdAt: open.createdAt.toISOString(),
			description: descriptionOf(open),
			statements: statementsOf(open),
			findings: measured.findings,
			findingsHash: measured.findingsHash,
			unclassified: unclassifiedOf(open),
			decisions: decisionsOf(open),
		};
	};

	/** The open request with this id, or `null`. */
	const findOpen = async (id: string): Promise<OpenRequest | null> =>
		(await findOpenRequests(trail, events)).find((open) => open.requestId === id) ?? null;

	/** Whether the account may decide. */
	const isAdmin = async (userId: string): Promise<boolean> =>
		(await findRole(trail, principals, userId)) === 'admin';

	return new Elysia({ name: 'glaze.approvals' })
		.use(createAuthMacro(auth))
		.error(({ error }) => {
			if (error instanceof ValidationError) {
				return buildErrorResponse(422, 'VALIDATION', 'Request body failed validation');
			}
			if (error instanceof ParseError) {
				return buildErrorResponse(400, 'VALIDATION', 'Request body is not valid JSON');
			}
			if (error instanceof NotFound) return buildErrorResponse(404, 'NOT_FOUND', 'Not found');
			const detail =
				error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error);
			logger.error(`Unhandled approvals-route error: ${detail}`);
			return buildErrorResponse(500, 'INTERNAL', 'Internal server error');
		})
		.get(base, { auth: true }, async () => {
			const open = await findOpenRequests(trail, events);
			const rows = await Promise.all(open.map(present));
			return buildListResponse(rows, { total: rows.length, limit: rows.length, offset: 0 });
		})
		.post(`${base}/:id/approve`, async ({ params, body, request }) => {
			const session = await resolveFreshSession(auth, request.headers);
			if (session.kind === 'none') {
				return buildErrorResponse(401, 'UNAUTHORIZED', 'Authentication required');
			}
			if (session.kind === 'malformed') {
				logger.error('The session for an approval carries no usable user id.');
				return buildErrorResponse(500, 'INTERNAL', 'Internal server error');
			}
			const userId = session.id;
			if (!(await isAdmin(userId))) {
				return buildErrorResponse(403, 'FORBIDDEN', 'Approving requires the admin role');
			}
			const seen = readText(body, 'seen');
			if (!seen) {
				return buildErrorResponse(
					422,
					'VALIDATION',
					'The fingerprint of the findings shown is required',
					[{ path: 'seen', message: 'required' }],
				);
			}
			const open = await findOpen(params.id);
			if (!open) return buildErrorResponse(404, 'NOT_FOUND', 'No such pending approval');

			const outcome = await approveRequest(context, open, seen, userId);
			if (outcome.outcome === 'applied') {
				logger.info(`Pending approval ${open.requestId} was approved by ${userId} and applied.`);
				return buildSuccessResponse({
					applied: true,
					statements: outcome.statements,
					migration: outcome.migration,
				});
			}
			if (outcome.outcome === 'apply_failed') {
				logger.error(
					`Pending approval ${open.requestId} was approved but could not be applied: ${outcome.detail}`,
				);
				return buildErrorResponse(
					409,
					'CONFLICT',
					`The change could not be applied: ${outcome.detail}`,
				);
			}
			const { refusal } = outcome;
			if (refusal.reason === 'already_decided') {
				return buildErrorResponse(409, 'CONFLICT', 'This request was decided a moment ago');
			}
			if (refusal.reason === 'counts_moved') {
				const counts = refusal.findings
					.map(
						(finding) =>
							`${finding.change.table}${'column' in finding.change ? `.${finding.change.column}` : ''}: ${finding.affectedRows ?? 'unknown'} rows`,
					)
					.join('; ');
				return buildErrorResponse(
					409,
					'CONFLICT',
					`The counts moved since you looked (${counts || 'nothing is affected now'}); fetch the list again and decide on the new numbers`,
				);
			}
			return buildErrorResponse(
				409,
				'CONFLICT',
				`The request cannot be approved: ${refusal.detail}`,
			);
		})
		.post(`${base}/:id/reject`, async ({ params, body, request }) => {
			const session = await resolveFreshSession(auth, request.headers);
			if (session.kind === 'none') {
				return buildErrorResponse(401, 'UNAUTHORIZED', 'Authentication required');
			}
			if (session.kind === 'malformed') {
				logger.error('The session for a rejection carries no usable user id.');
				return buildErrorResponse(500, 'INTERNAL', 'Internal server error');
			}
			const userId = session.id;
			if (!(await isAdmin(userId))) {
				return buildErrorResponse(403, 'FORBIDDEN', 'Rejecting requires the admin role');
			}
			const reason = readText(body, 'reason');
			if (!reason) {
				return buildErrorResponse(422, 'VALIDATION', 'A rejection needs a reason', [
					{ path: 'reason', message: 'required' },
				]);
			}
			const open = await findOpen(params.id);
			if (!open) return buildErrorResponse(404, 'NOT_FOUND', 'No such pending approval');

			await db.queryTransaction((tx) =>
				recordEvent(tx as ApprovalDb, events, {
					requestId: open.requestId,
					type: 'rejected',
					actorId: userId,
					actorKind: 'user',
					payload: { reason },
				}),
			);
			logger.info(`Pending approval ${open.requestId} was rejected by ${userId}: ${reason}`);
			return status(200, buildSuccessResponse({ rejected: true }));
		});
}
