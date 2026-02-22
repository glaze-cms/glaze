import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { validateDataConstraints } from './index';
import { containsUnquotedKeyword } from './utils';

// Mock DB
const mockExecute = mock(() => Promise.resolve({ rows: [] } as any));
const mockDb = {
	execute: mockExecute,
	transaction: mock(() => Promise.resolve()),
};

describe('validator', () => {
	beforeEach(() => {
		mockExecute.mockClear();
	});

	describe('checkNotNullConstraint', () => {
		it('should warn if adding NOT NULL to column with nulls', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ count: 10 }] });

			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "posts" ALTER COLUMN "excerpt" SET NOT NULL',
			]);

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(
				'POTENTIAL DATA LOSS: Adding NOT NULL constraint to "posts"."excerpt" will fail because 10 row(s) contain NULL values',
			);
			expect(mockExecute).toHaveBeenCalled();
		});

		it('should pass if adding NOT NULL to column without nulls', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ count: 0 }] });

			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "posts" ALTER COLUMN "excerpt" SET NOT NULL',
			]);

			expect(warnings).toHaveLength(0);
		});

		it('should ignore non-destructive SQL', async () => {
			const warnings = await validateDataConstraints(mockDb, [
				'CREATE TABLE "new_table" (id serial)',
			]);
			expect(warnings).toHaveLength(0);
			// Should not even query DB
			expect(mockExecute).toHaveBeenCalledTimes(0);
		});
	});

	describe('checkVarcharLength', () => {
		it('should warn if reducing varchar length causes truncation', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ count: 5 }] });

			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "users" ALTER COLUMN "bio" TYPE varchar(50)',
			]);

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(
				'POTENTIAL DATA LOSS: Reducing VARCHAR length on "users"."bio" to 50 will fail because 5 row(s) exceed this length',
			);
			expect(mockExecute).toHaveBeenCalled();
		});
	});

	describe('checkUniqueConstraint', () => {
		it('should warn if adding UNIQUE constraint to column with duplicates', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [{ email: 'dup@example.com', count: 2 }],
			});

			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "users" ADD CONSTRAINT "uk_email" UNIQUE ("email")',
			]);

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(
				'POTENTIAL DATA LOSS: Adding UNIQUE constraint to "users"."email" will fail because duplicate values exist',
			);
			expect(mockExecute).toHaveBeenCalled();
		});
	});

	describe('Security & Robustness', () => {
		it('should handle schema-qualified table names', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ count: 5 }] });

			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "public"."posts" ALTER COLUMN "excerpt" SET NOT NULL',
			]);

			expect(warnings).toHaveLength(1);
			expect(mockExecute).toHaveBeenCalled();
		});

		it('should handle tables with hyphens and special characters', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ count: 0 }] });

			await validateDataConstraints(mockDb, [
				'ALTER TABLE "my-app"."user-data" ALTER COLUMN "meta.info" SET NOT NULL',
			]);

			expect(mockExecute).toHaveBeenCalled();
		});

		it('should reject SQL injection attempts in table names', async () => {
			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "users; DROP TABLE users; --" ALTER COLUMN "bio" SET NOT NULL',
			]);

			// Should return no warnings (because it refused to execute)
			// Ideally we could spy on logger warning, but here we check no DB call happened
			expect(mockExecute).not.toHaveBeenCalled();
			expect(warnings).toHaveLength(0);
		});

		it('should reject SQL injection attempts in column names', async () => {
			await validateDataConstraints(mockDb, [
				'ALTER TABLE "users" ALTER COLUMN "id; DROP TABLE users" SET NOT NULL',
			]);

			expect(mockExecute).not.toHaveBeenCalled();
		});
	});

	describe('checkAddColumnNotNull', () => {
		it('should warn if adding NOT NULL column to table with rows', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "posts" ADD COLUMN "excerpt" text NOT NULL',
			]);

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(
				'POTENTIAL DATA LOSS: Adding NOT NULL column "posts"."excerpt" without a DEFAULT value will fail because the table is not empty',
			);
		});

		it('should pass if table is empty', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "posts" ADD COLUMN "excerpt" text NOT NULL',
			]);

			expect(warnings).toHaveLength(0);
		});

		it('should pass if column has DEFAULT value', async () => {
			// even if table has rows
			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "posts" ADD COLUMN "status" text DEFAULT \'draft\' NOT NULL',
			]);

			expect(warnings).toHaveLength(0);
		});

		it('should not treat identifier containing DEFAULT as a DEFAULT clause', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

			const warnings = await validateDataConstraints(mockDb, [
				'ALTER TABLE "DEFAULT" ADD COLUMN "excerpt" text NOT NULL',
			]);

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain(
				'POTENTIAL DATA LOSS: Adding NOT NULL column "DEFAULT"."excerpt" without a DEFAULT value will fail because the table is not empty',
			);
		});
	});

	describe('containsUnquotedKeyword', () => {
		it('should detect keyword outside quotes (case-insensitive, with boundaries)', () => {
			expect(
				containsUnquotedKeyword(
					'ALTER TABLE "posts" ADD COLUMN "status" text default \'draft\' NOT NULL',
					'DEFAULT',
				),
			).toBe(true);
			// Boundaries: should not match as part of a larger identifier word
			expect(containsUnquotedKeyword('DEFAULTS', 'DEFAULT')).toBe(false);
			expect(containsUnquotedKeyword('MYDEFAULT', 'DEFAULT')).toBe(false);
		});

		it('should ignore keyword inside single-quoted string literals (including escaped quotes)', () => {
			expect(
				containsUnquotedKeyword("CHECK (status <> 'DEFAULT')", 'DEFAULT'),
			).toBe(false);
			expect(
				containsUnquotedKeyword("CHECK (note = 'it''s DEFAULT')", 'DEFAULT'),
			).toBe(false);
		});

		it('should ignore keyword inside double-quoted identifiers (including escaped quotes)', () => {
			expect(
				containsUnquotedKeyword(
					'ALTER TABLE "DEFAULT" ADD COLUMN "x" text NOT NULL',
					'DEFAULT',
				),
			).toBe(false);
			expect(containsUnquotedKeyword('"DEFA""ULT"', 'DEFAULT')).toBe(false);
		});
	});
});
