/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { isValidIdentifier } from '@glaze/shared';
import { sql } from 'drizzle-orm';
import type { Logger } from '@glaze/logger';
import type { DrizzleDatabase } from '../../types/index';
import { sqlIdentifier, containsUnquotedKeyword } from './utils';

// ============================================================
// Individual Constraint Validators
// ============================================================

/**
 * Checks if adding NOT NULL will fail due to existing NULL values.
 */
export async function checkNotNullConstraint(
	db: DrizzleDatabase,
	statement: string,
	logger?: Logger,
): Promise<string | null> {
	logger?.debug(`[NOT NULL Check] SQL: ${statement}`);

	// Match table (possibly with schema) and column
	const match = statement.match(
		/ALTER\s+TABLE\s+((?:"[^";]+"\.)?"[^";]+")\s+ALTER\s+COLUMN\s+"([^";]+)"\s+SET\s+NOT\s+NULL/i,
	);

	logger?.debug(`[NOT NULL Check] Match: ${JSON.stringify(match)}`);

	if (!match) return null;

	const [, table, column] = match;
	if (!table || !column) return null;

	// Validate identifiers to prevent SQL injection
	if (!isValidIdentifier(table) || !isValidIdentifier(column)) {
		logger?.warn(`Invalid table or column name detected: ${table}.${column}`);
		return null;
	}

	logger?.debug(`[NOT NULL Check] Table: ${table}, Column: ${column}`);

	const tableRef = sqlIdentifier(table);

	try {
		const colRef = sql.raw(`"${column}"`);
		const query = sql`SELECT COUNT(*) as count FROM ${tableRef} WHERE ${colRef} IS NULL`;

		const result = await db.execute(query);
		logger?.debug(`[NOT NULL Check] Result: ${JSON.stringify(result)}`);

		const rows = 'rows' in result ? result.rows : result;

		const nullCount = Number(rows[0]?.count ?? 0);
		logger?.debug(`[NOT NULL Check] NULL count: ${String(nullCount)}`);

		if (nullCount > 0) {
			return `⚠️  POTENTIAL DATA LOSS: Adding NOT NULL constraint to ${table}."${column}" will fail because ${String(nullCount)} row(s) contain NULL values.`;
		}
	} catch (e) {
		if (logger) {
			logger.debug(
				`Failed to check NULLs for ${table}.${column}: ${String(e)}`,
			);
		} else {
			// eslint-disable-next-line no-console
			console.error('[NOT NULL Check] Error:', e);
		}
	}

	return null;
}

/**
 * Checks if reducing VARCHAR length will fail due to existing data.
 */
export async function checkVarcharLength(
	db: DrizzleDatabase,
	statement: string,
	logger?: Logger,
): Promise<string | null> {
	const match = statement.match(
		/ALTER\s+TABLE\s+((?:"[^";]+"\.)?"[^";]+")\s+ALTER\s+COLUMN\s+"([^";]+)"\s+TYPE\s+(?:character\s+varying|varchar)\((\d+)\)/i,
	);

	if (!match) return null;

	const [, table, column, newLength] = match;
	if (!table || !column || !newLength) return null;

	if (!isValidIdentifier(table) || !isValidIdentifier(column)) return null;

	const tableRef = sqlIdentifier(table);

	try {
		const colRef = sql.raw(`"${column}"`);
		const query = sql`SELECT COUNT(*) as count FROM ${tableRef} WHERE LENGTH(${colRef}) > ${Number(newLength)}`;

		const result = await db.execute(query);

		const rows = 'rows' in result ? result.rows : result;

		const overflowCount = Number(rows[0]?.count ?? 0);

		if (overflowCount > 0) {
			return `⚠️  POTENTIAL DATA LOSS: Reducing VARCHAR length on ${table}."${column}" to ${newLength} will fail because ${String(overflowCount)} row(s) exceed this length.`;
		}
	} catch (e) {
		logger?.debug(
			`Failed to check length for ${table}.${column}: ${String(e)}`,
		);
	}

	return null;
}

/**
 * Checks if adding UNIQUE constraint will fail due to duplicate values.
 */
export async function checkUniqueConstraint(
	db: DrizzleDatabase,
	statement: string,
	logger?: Logger,
): Promise<string | null> {
	const match = statement.match(
		/ALTER\s+TABLE\s+((?:"[^";]+"\.)?"[^";]+")\s+ADD\s+CONSTRAINT\s+"[^";]+"\s+UNIQUE\s*\("([^";]+)"\)/i,
	);

	if (!match) return null;

	const [, table, column] = match;
	if (!table || !column) return null;

	if (!isValidIdentifier(table) || !isValidIdentifier(column)) return null;

	const tableRef = sqlIdentifier(table);

	try {
		const colRef = sql.raw(`"${column}"`);
		const query = sql`SELECT ${colRef}, COUNT(*) as count FROM ${tableRef} GROUP BY ${colRef} HAVING COUNT(*) > 1 LIMIT 1`;

		const result = await db.execute(query);

		const rows = 'rows' in result ? result.rows : result;

		if (rows.length > 0) {
			return `⚠️  POTENTIAL DATA LOSS: Adding UNIQUE constraint to ${table}."${column}" will fail because duplicate values exist.`;
		}
	} catch (e) {
		logger?.debug(
			`Failed to check duplicates for ${table}.${column}: ${String(e)}`,
		);
	}

	return null;
}

/**
 * Checks if adding a new column with NOT NULL will fail due to existing rows.
 */
export async function checkAddColumnNotNull(
	db: DrizzleDatabase,
	statement: string,
	logger?: Logger,
): Promise<string | null> {
	// Match ADD COLUMN ... NOT NULL (without DEFAULT)
	const match = statement.match(
		/ALTER\s+TABLE\s+((?:"[^";]+"\.)?"[^";]+")\s+ADD\s+COLUMN\s+"([^";]+)"\s+[^";]+\s+NOT\s+NULL/i,
	);

	if (!match) return null;

	if (containsUnquotedKeyword(statement, 'DEFAULT')) {
		return null;
	}

	const [, table, column] = match;
	if (!table || !column) return null;

	if (!isValidIdentifier(table) || !isValidIdentifier(column)) return null;

	const tableRef = sqlIdentifier(table);

	try {
		const query = sql`SELECT 1 FROM ${tableRef} LIMIT 1`;
		const result = await db.execute(query);
		const rows = 'rows' in result ? result.rows : result;
		const hasRows = Array.isArray(rows) && rows.length > 0;

		if (hasRows) {
			return `⚠️  POTENTIAL DATA LOSS: Adding NOT NULL column ${table}."${column}" without a DEFAULT value will fail because the table is not empty.`;
		}
	} catch (e) {
		logger?.debug(`Failed to check rows for ${table}: ${String(e)}`);
	}

	return null;
}
