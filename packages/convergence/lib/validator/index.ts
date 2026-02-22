import type { Logger } from '@glaze/logger';
import type { DrizzleDatabase } from '../../types/index';
import {
	checkNotNullConstraint,
	checkVarcharLength,
	checkUniqueConstraint,
	checkAddColumnNotNull,
} from './constraints';

/**
 * Validates that schema changes won't fail due to existing data.
 * Catches issues that drizzle-kit's --explain misses.
 *
 * @param db - Drizzle database instance
 * @param statements - SQL statements from drizzle-kit
 * @param logger - Optional logger for debug output
 * @returns Array of warning messages
 */
export async function validateDataConstraints(
	db: DrizzleDatabase,
	statements: string[],
	logger?: Logger,
): Promise<string[]> {
	if (statements.length === 0) {
		logger?.debug('No SQL statements to validate');
		return [];
	}

	logger?.debug(`Validating ${String(statements.length)} SQL statement(s)`);

	const validators = [
		checkNotNullConstraint,
		checkVarcharLength,
		checkUniqueConstraint,
		checkAddColumnNotNull,
	];

	const warnings: string[] = [];

	for (const statement of statements) {
		for (const validator of validators) {
			const warning = await validator(db, statement, logger);
			if (warning) warnings.push(warning);
		}
	}

	return warnings;
}
