/**
 * The pending-approvals API: what is waiting, and the two ways to answer it.
 *
 * Reading is open to any authenticated account; deciding requires `admin`. That split is the whole
 * permission model for now — `propose` and `approve` become real actions when the policy model lands
 * (AGENTS.md §1), and this is the placeholder shaped to be replaced by it.
 *
 * Every error is kept inside the `{ success, data, error }` envelope by a scope-local handler, for
 * the same reason the content router has one: an error left unhandled ships as the framework's
 * `application/problem+json` and breaks the response contract.
 */

import { Elysia, NotFound, ParseError, t, ValidationError } from 'elysia';

import { createAuthMacro } from '../auth/index.ts';
import { buildErrorResponse, buildListResponse, buildSuccessResponse } from '../responses/index.ts';
import { applyApprovedChange, readRequestedPayload, recordApproval } from './handlers.ts';
import { buildApprovalSchema } from './schema/index.ts';
import { findOpenRequest, findRole, recordEvent } from './store.ts';

import type { GlazeContext } from '../app/context.ts';
import type { SessionProvider } from '../auth/index.ts';
import type { ApprovalDb, OpenRequest } from './store.ts';
import type { Table } from 'drizzle-orm';

/** The route segment the approvals API owns under the API prefix. */
export const APPROVALS_ROUTE_NAME = 'pending-approvals';

/** The inputs the approvals router is composed from. */
interface ApprovalsRouterInput {
	/** The Glaze context (database handle, resolved config, logger). */
	readonly context: GlazeContext;
	/** The shared Better Auth instance backing the route gate. */
	readonly auth: SessionProvider;
}

/** A rejection must say why; an empty reason makes the trail useless where it matters most. */
const REJECTION_BODY = t.Object({ reason: t.String({ minLength: 1 }) });

/** The approvals tables, built once for the life of the router. */
interface Tables {
	readonly events: Table;
	readonly principals: Table;
}

/**
 * Reads the signed-in account's id from what the auth macro injected.
 *
 * @param user - The macro's `user`, typed `unknown` at the boundary.
 * @returns The account id, or `null` when it is not shaped as expected.
 */
function accountId(user: unknown): string | null {
	const id = (user as { id?: unknown } | null)?.id;
	return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Renders an open request for the API: what it will do, and what it will cost.
 *
 * @param request - The open request.
 * @returns The response shape.
 */
function present(request: OpenRequest): Record<string, unknown> {
	const payload = readRequestedPayload(request.payload);
	return {
		id: request.requestId,
		changeHash: request.changeHash,
		createdAt: request.createdAt.toISOString(),
		origin: payload.origin ?? 'dev',
		statements: payload.statements ?? [],
		findings: payload.findings ?? [],
	};
}

/**
 * Composes the approvals routes.
 *
 * @param input - The context and the shared auth instance.
 * @returns The Elysia plugin to mount.
 */
export function createApprovalsRouter({ context, auth }: ApprovalsRouterInput) {
	const { logger, options } = context;
	const schema = buildApprovalSchema(context.config.dialect);
	const tables: Tables = {
		events: schema.approvalEvents as Table,
		principals: schema.principals as Table,
	};
	const db = context.db.db as ApprovalDb;
	const base = `${options.prefixes.api}/${APPROVALS_ROUTE_NAME}`;

	const app = new Elysia({ name: 'glaze.approvals' })
		.use(createAuthMacro(auth))
		.error(({ error }) => {
			if (error instanceof ValidationError) {
				return buildErrorResponse(422, 'VALIDATION', 'A reason is required to reject a change');
			}
			if (error instanceof ParseError) {
				return buildErrorResponse(400, 'VALIDATION', 'Request body is not valid JSON');
			}
			if (error instanceof NotFound) return buildErrorResponse(404, 'NOT_FOUND', 'Not found');
			const detail =
				error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error);
			logger.error(`Unhandled approvals-route error: ${detail}`);
			return buildErrorResponse(500, 'INTERNAL', 'Internal server error');
		});

	app.get(base, { auth: true }, async () => {
		const open = await findOpenRequest(db, tables.events);
		const rows = open ? [present(open)] : [];
		return buildListResponse(rows, { total: rows.length, limit: rows.length, offset: 0 });
	});

	app.post(`${base}/:id/approve`, { auth: true }, async ({ params, user }) => {
		const decided = await resolveDecider(user);
		if ('error' in decided) return decided.error;

		const open = await findOpenRequest(db, tables.events);
		if (!open || open.requestId !== params.id) {
			return buildErrorResponse(404, 'NOT_FOUND', 'No pending approval with that id');
		}

		const outcome = await applyApprovedChange(context, open);
		if (outcome.status === 'error') {
			logger.error(`Approving ${open.requestId} could not proceed: ${outcome.detail}`);
			return buildErrorResponse(500, 'INTERNAL', 'The change could not be applied');
		}
		if (outcome.status === 'nothing_to_apply') {
			return buildErrorResponse(409, 'CONFLICT', 'This change is no longer present in the schema');
		}

		await recordApproval(db, tables.events, open.requestId, decided.actorId, outcome);

		if (outcome.status === 'superseded') {
			return buildErrorResponse(
				409,
				'CONFLICT',
				'The schema changed since this was filed; a new approval has to be raised',
			);
		}
		if (outcome.status === 'findings_moved') {
			return buildErrorResponse(
				409,
				'CONFLICT',
				'What this change would destroy has changed since it was filed; look again before approving',
			);
		}
		if (outcome.status === 'apply_failed') {
			return buildErrorResponse(422, 'VALIDATION', 'The database refused the change');
		}
		return buildSuccessResponse({ id: open.requestId, statements: outcome.statements });
	});

	app.post(
		`${base}/:id/reject`,
		{ auth: true, body: REJECTION_BODY },
		async ({ params, body, user }) => {
			const decided = await resolveDecider(user);
			if ('error' in decided) return decided.error;

			const open = await findOpenRequest(db, tables.events);
			if (!open || open.requestId !== params.id) {
				return buildErrorResponse(404, 'NOT_FOUND', 'No pending approval with that id');
			}

			await recordEvent(db, tables.events, {
				requestId: open.requestId,
				type: 'rejected',
				actorId: decided.actorId,
				actorKind: 'user',
				payload: { reason: body.reason },
			});
			return buildSuccessResponse({ id: open.requestId });
		},
	);

	/**
	 * Resolves who is deciding, and whether they may.
	 *
	 * @param user - The macro's injected account.
	 * @returns The deciding account's id, or the error response to return instead.
	 */
	async function resolveDecider(
		user: unknown,
	): Promise<{ actorId: string } | { error: ReturnType<typeof buildErrorResponse> }> {
		const id = accountId(user);
		if (!id) return { error: buildErrorResponse(401, 'UNAUTHORIZED', 'Authentication required') };

		const role = await findRole(db, tables.principals, id);
		if (role !== 'admin') {
			return {
				error: buildErrorResponse(403, 'FORBIDDEN', 'Only an admin can decide on a change'),
			};
		}
		return { actorId: id };
	}

	return app;
}
