/**
 * Giving a new account its role.
 *
 * Better Auth owns account creation, so this is the one moment a role can be assigned by Glaze
 * rather than asked for by a caller. The rule lives here, in approvals; `server/auth/instance.ts`
 * only wires the resulting hook into the Better Auth options, so the module that decides who can do
 * what is not the module that decides who can sign in.
 */

import { buildApprovalSchema } from './schema/index.ts';
import { enrolPrincipal } from './store.ts';

import type { GlazeContext } from '../app/context.ts';
import type { ApprovalDb } from './store.ts';
import type { Table } from 'drizzle-orm';

/** The account fields Better Auth hands to a `user.create.after` hook that this needs. */
interface CreatedUser {
	readonly id: string;
}

/**
 * Builds the Better Auth `databaseHooks.user.create.after` hook that records a new account's role.
 *
 * This makes sign-up depend on the approvals tables existing. `handleStart` materializes them before
 * the server accepts traffic, so that only fails when boot skipped a step — and failing there is
 * right: an account with no role is worse than a sign-up that did not happen.
 *
 * The hook runs once the account row exists, so a failure leaves an account with no role — and,
 * worse, leaves the principals table empty so the *next* account becomes `admin`. It therefore logs
 * and rethrows rather than swallowing: on a fresh install, which is the only time this matters, the
 * failure surfaces immediately instead of silently handing the keys to whoever signs up second.
 *
 * @param context - The Glaze context (database handle, config, logger).
 * @returns The hook to pass to Better Auth.
 */
export function createPrincipalEnrolment(
	context: GlazeContext,
): (user: CreatedUser) => Promise<void> {
	const { db, config, logger } = context;

	return async (user) => {
		const principals = buildApprovalSchema(config.dialect).principals as Table;
		try {
			const role = await enrolPrincipal(db.db as ApprovalDb, principals, user.id);
			logger.debug(`Glaze enrolled a new account as ${role}.`);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.error(`Glaze could not assign a role to the new account: ${detail}`);
			throw error;
		}
	};
}
