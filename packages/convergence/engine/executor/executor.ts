import { sql } from 'drizzle-orm';

import type {
	ApplyStatementsOptions,
	ApplyStatementsResult,
} from '../../types/index';

/**
 * Applies SQL statements to the database in a transaction.
 *
 * Uses the existing database connection from the server instead of creating a new one.
 *
 * @param options - Apply options
 * @returns Result of the operation
 */
export async function applyStatements(
	options: ApplyStatementsOptions,
): Promise<ApplyStatementsResult> {
	const { statements, db, logger } = options;

	if (statements.length === 0) {
		return { success: true, appliedCount: 0 };
	}

	try {
		logger.info(`Applying ${String(statements.length)} change(s)...`);

		await db.transaction(async (tx) => {
			for (const statement of statements) {
				logger.debug(`Executing: ${statement}`);
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
				await tx.execute(sql.raw(statement));
			}
		});

		logger.info(
			`✓ Successfully applied ${String(statements.length)} change(s)`,
		);

		return {
			success: true,
			appliedCount: statements.length,
		};
	} catch (error) {
		logger.error('Failed to apply schema changes');

		if (error instanceof Error) {
			logger.error(error.message);
			if (error.stack) {
				logger.debug(error.stack);
			}
			if ('cause' in error && error.cause) {
				logger.error(error.cause);
			}
		} else {
			logger.error(String(error));
		}

		return {
			success: false,
			appliedCount: 0,
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}
