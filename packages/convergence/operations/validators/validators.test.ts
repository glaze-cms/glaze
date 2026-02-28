import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
	GLAZE_RESERVED_NAMES,
	columnExists,
	columnHasNulls,
	getTableReferences,
	isReservedName,
	tableExists,
	tableIsEmpty,
} from './validators';

// Mock DB
const mockExecute = mock(() => Promise.resolve({ rows: [] } as any));
const mockDb = { execute: mockExecute };

describe('validators', () => {
	beforeEach(() => {
		mockExecute.mockClear();
	});

	describe('isReservedName', () => {
		it('returns true for Glaze internal table names', () => {
			expect(isReservedName('users')).toBe(true);
			expect(isReservedName('sessions')).toBe(true);
			expect(isReservedName('accounts')).toBe(true);
			expect(isReservedName('verifications')).toBe(true);
		});

		it('returns true for Postgres system reserved names', () => {
			expect(isReservedName('public')).toBe(true);
			expect(isReservedName('pg_catalog')).toBe(true);
		});

		it('covers every entry in GLAZE_RESERVED_NAMES', () => {
			for (const name of GLAZE_RESERVED_NAMES) {
				expect(isReservedName(name)).toBe(true);
			}
		});

		it('returns false for a normal, non-reserved name', () => {
			expect(isReservedName('articles')).toBe(false);
		});

		it('is case-insensitive — uppercased input still matches', () => {
			expect(isReservedName('USERS')).toBe(true);
		});

		it('is case-insensitive — mixed-case input still matches', () => {
			expect(isReservedName('Users')).toBe(true);
		});
	});

	describe('tableExists', () => {
		it('returns true when execute resolves with a rows wrapper containing a row', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ '1': 1 }] });
			const result = await tableExists(mockDb as never, 'articles');
			expect(result).toBe(true);
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('returns false when execute resolves with a rows wrapper containing no rows', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });
			const result = await tableExists(mockDb as never, 'articles');
			expect(result).toBe(false);
		});

		it('returns true when execute resolves directly as an array with a row (no rows wrapper)', async () => {
			mockExecute.mockResolvedValueOnce([{ '1': 1 }]);
			const result = await tableExists(mockDb as never, 'articles');
			expect(result).toBe(true);
		});

		it('returns false when execute resolves directly as an empty array (no rows wrapper)', async () => {
			mockExecute.mockResolvedValueOnce([]);
			const result = await tableExists(mockDb as never, 'articles');
			expect(result).toBe(false);
		});
	});

	describe('columnExists', () => {
		it('returns true when execute resolves with rows present', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ '1': 1 }] });
			const result = await columnExists(mockDb as never, 'articles', 'title');
			expect(result).toBe(true);
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('returns false when execute resolves with empty rows', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });
			const result = await columnExists(mockDb as never, 'articles', 'title');
			expect(result).toBe(false);
		});
	});

	describe('tableIsEmpty', () => {
		it('returns true when the query row has empty: true', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ empty: true }] });
			const result = await tableIsEmpty(mockDb as never, 'articles');
			expect(result).toBe(true);
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('returns false when the query row has empty: false', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ empty: false }] });
			const result = await tableIsEmpty(mockDb as never, 'articles');
			expect(result).toBe(false);
		});
	});

	describe('columnHasNulls', () => {
		it('returns true when the query row has has_nulls: true', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ has_nulls: true }] });
			const result = await columnHasNulls(mockDb as never, 'articles', 'title');
			expect(result).toBe(true);
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('returns false when the query row has has_nulls: false', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [{ has_nulls: false }] });
			const result = await columnHasNulls(mockDb as never, 'articles', 'title');
			expect(result).toBe(false);
		});
	});

	describe('getTableReferences', () => {
		it('returns an array of referencing_table strings when rows are present', async () => {
			mockExecute.mockResolvedValueOnce({
				rows: [
					{ referencing_table: 'comments' },
					{ referencing_table: 'likes' },
				],
			});
			const result = await getTableReferences(mockDb as never, 'articles');
			expect(result).toEqual(['comments', 'likes']);
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('returns an empty array when no rows are present', async () => {
			mockExecute.mockResolvedValueOnce({ rows: [] });
			const result = await getTableReferences(mockDb as never, 'articles');
			expect(result).toEqual([]);
		});
	});
});
