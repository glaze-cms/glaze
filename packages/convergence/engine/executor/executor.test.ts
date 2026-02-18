import { describe, it, expect, beforeEach } from 'bun:test';
import { sql } from 'drizzle-orm';

import { createLogger, type Logger } from '@glaze/logger';

import { applyStatements } from './executor';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */

// Mock database that validates SQL objects (not raw strings)

const createMockDb = (shouldFail = false): NodePgDatabase<any> => {
	const mockTransaction = async (callback: any) => {
		if (shouldFail) {
			throw new Error('Transaction failed');
		}
		// Simulate transaction callback
		const mockTx = {
			execute: (query: any) => {
				// Validate that execute receives a SQL object, not a raw string
				if (typeof query === 'string') {
					throw new Error(
						'execute() expects a SQL object (use sql.raw()), not a raw string',
					);
				}
				return Promise.resolve({ rows: [] });
			},
		};
		await callback(mockTx);
	};

	return {
		transaction: mockTransaction,
		execute: () => Promise.resolve({ rows: [] }),
	} as any;
};

describe('applyStatements', () => {
	let logger: Logger;

	beforeEach(() => {
		logger = createLogger({ name: 'test' });
	});

	it('should return success with 0 applied when no statements provided', async () => {
		const db = createMockDb();

		const result = await applyStatements({
			statements: [],
			db,
			logger,
		});

		expect(result.success).toBe(true);
		expect(result.appliedCount).toBe(0);
		expect(result.error).toBeUndefined();
	});

	it('should apply statements successfully', async () => {
		const db = createMockDb();
		const statements = [
			'CREATE TABLE test (id UUID PRIMARY KEY)',
			'ALTER TABLE test ADD COLUMN name TEXT',
		];

		const result = await applyStatements({
			statements,
			db,
			logger,
		});

		expect(result.success).toBe(true);
		expect(result.appliedCount).toBe(2);
		expect(result.error).toBeUndefined();
	});

	it('should return error when transaction fails', async () => {
		const db = createMockDb(true); // shouldFail = true
		const statements = ['CREATE TABLE test (id UUID PRIMARY KEY)'];

		const result = await applyStatements({
			statements,
			db,
			logger,
		});

		expect(result.success).toBe(false);
		expect(result.appliedCount).toBe(0);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toBe('Transaction failed');
	});
});
