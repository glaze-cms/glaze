import { describe, it, expect, beforeEach, mock } from 'bun:test';

import { addField, renameField, dropField, alterField } from './fields';

const mockExecute = mock(() => Promise.resolve({ rows: [] as any[] }));
const mockDb = { execute: mockExecute };

beforeEach(() => {
	mockExecute.mockClear();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** tableExists → true (rows present) */
const tableFound = { rows: [{ '?column?': 1 }] };
/** tableExists → false (no rows) */
const tableNotFound = { rows: [] };
/** columnExists → true */
const columnFound = { rows: [{ '?column?': 1 }] };
/** columnExists → false */
const columnNotFound = { rows: [] };
/** tableIsEmpty → table IS empty */
const tableEmpty = { rows: [{ empty: true }] };
/** tableIsEmpty → table is NOT empty */
const tableNotEmpty = { rows: [{ empty: false }] };
/** columnHasNulls → column contains NULL values */
const nullsFound = { rows: [{ has_nulls: true }] };
/** columnHasNulls → column contains no NULL values */
const noNullsFound = { rows: [{ has_nulls: false }] };

// ─── addField ─────────────────────────────────────────────────────────────────

describe('addField', () => {
	it('returns COLLECTION_NOT_FOUND when the table does not exist', async () => {
		mockExecute.mockResolvedValueOnce(tableNotFound);

		const result = await addField(mockDb as never, {
			collection: 'articles',
			field: { name: 'title', type: 'text' },
		});

		expect(result).toEqual({
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection: 'articles' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('returns RESERVED_NAME when the field name is reserved', async () => {
		mockExecute.mockResolvedValueOnce(tableFound); // tableExists

		const result = await addField(mockDb as never, {
			collection: 'articles',
			field: { name: 'users', type: 'text' },
		});

		expect(result).toEqual({
			success: false,
			code: 'RESERVED_NAME',
			error: { field: 'users' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('returns FIELD_ALREADY_EXISTS when the column already exists', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound); // columnExists

		const result = await addField(mockDb as never, {
			collection: 'articles',
			field: { name: 'title', type: 'text' },
		});

		expect(result).toEqual({
			success: false,
			code: 'FIELD_ALREADY_EXISTS',
			error: { collection: 'articles', field: 'title' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it('returns FIELD_NOT_NULL_NO_DEFAULT when NOT NULL, no default, and table is non-empty', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnNotFound) // columnExists
			.mockResolvedValueOnce(tableNotEmpty); // tableIsEmpty

		const result = await addField(mockDb as never, {
			collection: 'articles',
			field: { name: 'title', type: 'text', nullable: false },
		});

		expect(result).toEqual({
			success: false,
			code: 'FIELD_NOT_NULL_NO_DEFAULT',
			error: { collection: 'articles', field: 'title' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});

	it('succeeds when NOT NULL, no default, and table is empty', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnNotFound) // columnExists
			.mockResolvedValueOnce(tableEmpty) // tableIsEmpty
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await addField(mockDb as never, {
			collection: 'articles',
			field: { name: 'title', type: 'text', nullable: false },
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.sql).toContain('ALTER TABLE');
			expect(result.sql).toContain('ADD COLUMN');
			expect(result.sql).toContain('NOT NULL');
		}
		expect(mockExecute).toHaveBeenCalledTimes(4);
	});

	it('succeeds without checking tableIsEmpty when the field is nullable', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnNotFound) // columnExists
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await addField(mockDb as never, {
			collection: 'articles',
			field: { name: 'title', type: 'text' }, // nullable defaults to true
		});

		expect(result.success).toBe(true);
		// tableIsEmpty must NOT have been called — only 3 execute calls total
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});

	it('succeeds without checking tableIsEmpty when NOT NULL but a default is provided', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnNotFound) // columnExists
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await addField(mockDb as never, {
			collection: 'articles',
			field: {
				name: 'title',
				type: 'text',
				nullable: false,
				default: 'untitled',
			},
		});

		expect(result.success).toBe(true);
		// tableIsEmpty must NOT have been called
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});
});

// ─── renameField ──────────────────────────────────────────────────────────────

describe('renameField', () => {
	it('returns COLLECTION_NOT_FOUND when the table does not exist', async () => {
		mockExecute.mockResolvedValueOnce(tableNotFound);

		const result = await renameField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			newName: 'headline',
		});

		expect(result).toEqual({
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection: 'articles' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('returns FIELD_NOT_FOUND when the source column does not exist', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnNotFound); // columnExists (source)

		const result = await renameField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			newName: 'headline',
		});

		expect(result).toEqual({
			success: false,
			code: 'FIELD_NOT_FOUND',
			error: { collection: 'articles', field: 'title' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it('returns RESERVED_NAME when the new name is reserved', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound); // columnExists (source)

		const result = await renameField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			newName: 'sessions',
		});

		expect(result).toEqual({
			success: false,
			code: 'RESERVED_NAME',
			error: { field: 'sessions' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it('returns FIELD_ALREADY_EXISTS when the target column already exists', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists (source)
			.mockResolvedValueOnce(columnFound); // columnExists (target)

		const result = await renameField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			newName: 'headline',
		});

		expect(result).toEqual({
			success: false,
			code: 'FIELD_ALREADY_EXISTS',
			error: { collection: 'articles', field: 'headline' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});

	it('succeeds and returns the RENAME COLUMN sql', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists (source)
			.mockResolvedValueOnce(columnNotFound) // columnExists (target)
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await renameField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			newName: 'headline',
		});

		expect(result).toEqual({
			success: true,
			sql: 'ALTER TABLE articles RENAME COLUMN title TO headline;',
		});
		expect(mockExecute).toHaveBeenCalledTimes(4);
	});
});

// ─── dropField ────────────────────────────────────────────────────────────────

describe('dropField', () => {
	it('returns COLLECTION_NOT_FOUND when the table does not exist', async () => {
		mockExecute.mockResolvedValueOnce(tableNotFound);

		const result = await dropField(mockDb as never, {
			collection: 'articles',
			field: 'title',
		});

		expect(result).toEqual({
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection: 'articles' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('returns FIELD_NOT_FOUND when the column does not exist', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnNotFound); // columnExists

		const result = await dropField(mockDb as never, {
			collection: 'articles',
			field: 'title',
		});

		expect(result).toEqual({
			success: false,
			code: 'FIELD_NOT_FOUND',
			error: { collection: 'articles', field: 'title' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it('succeeds and returns the DROP COLUMN sql', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await dropField(mockDb as never, {
			collection: 'articles',
			field: 'title',
		});

		expect(result).toEqual({
			success: true,
			sql: 'ALTER TABLE articles DROP COLUMN title;',
		});
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});
});

// ─── alterField ───────────────────────────────────────────────────────────────

describe('alterField', () => {
	it('returns COLLECTION_NOT_FOUND when the table does not exist', async () => {
		mockExecute.mockResolvedValueOnce(tableNotFound);

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: { nullable: true },
		});

		expect(result).toEqual({
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection: 'articles' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('returns FIELD_NOT_FOUND when the column does not exist', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnNotFound); // columnExists

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: { nullable: true },
		});

		expect(result).toEqual({
			success: false,
			code: 'FIELD_NOT_FOUND',
			error: { collection: 'articles', field: 'title' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it('returns NO_CHANGES when the changes object is empty', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound); // columnExists

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: {},
		});

		expect(result).toEqual({
			success: false,
			code: 'NO_CHANGES',
			error: { collection: 'articles', field: 'title' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it('returns FIELD_HAS_NULL_VALUES when nullable: false and column contains NULLs', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists
			.mockResolvedValueOnce(nullsFound); // columnHasNulls

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: { nullable: false },
		});

		expect(result).toEqual({
			success: false,
			code: 'FIELD_HAS_NULL_VALUES',
			error: { collection: 'articles', field: 'title' },
		});
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});

	it('succeeds with SET NOT NULL sql when nullable: false and column has no NULLs', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists
			.mockResolvedValueOnce(noNullsFound) // columnHasNulls
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: { nullable: false },
		});

		expect(result).toEqual({
			success: true,
			sql: 'ALTER TABLE articles ALTER COLUMN title SET NOT NULL;',
		});
		expect(mockExecute).toHaveBeenCalledTimes(4);
	});

	it('succeeds with DROP NOT NULL sql when nullable: true', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: { nullable: true },
		});

		expect(result).toEqual({
			success: true,
			sql: 'ALTER TABLE articles ALTER COLUMN title DROP NOT NULL;',
		});
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});

	it("succeeds with DROP DEFAULT sql when default: 'drop'", async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: { default: 'drop' },
		});

		expect(result).toEqual({
			success: true,
			sql: 'ALTER TABLE articles ALTER COLUMN title DROP DEFAULT;',
		});
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});

	it('succeeds with SET DEFAULT sql when a default value is provided', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists
			.mockResolvedValueOnce({ rows: [] }); // execute statement

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: { default: 'untitled' },
		});

		expect(result).toEqual({
			success: true,
			sql: "ALTER TABLE articles ALTER COLUMN title SET DEFAULT 'untitled';",
		});
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});

	it('succeeds with two statements joined by newline when both nullable: true and default value are changed', async () => {
		mockExecute
			.mockResolvedValueOnce(tableFound) // tableExists
			.mockResolvedValueOnce(columnFound) // columnExists
			.mockResolvedValueOnce({ rows: [] }) // execute DROP NOT NULL
			.mockResolvedValueOnce({ rows: [] }); // execute SET DEFAULT

		const result = await alterField(mockDb as never, {
			collection: 'articles',
			field: 'title',
			changes: { nullable: true, default: 'untitled' },
		});

		expect(result.success).toBe(true);
		if (result.success) {
			const parts = result.sql.split('\n');
			expect(parts).toHaveLength(2);
			expect(parts[0]).toBe(
				'ALTER TABLE articles ALTER COLUMN title DROP NOT NULL;',
			);
			expect(parts[1]).toBe(
				"ALTER TABLE articles ALTER COLUMN title SET DEFAULT 'untitled';",
			);
		}
		expect(mockExecute).toHaveBeenCalledTimes(4);
	});
});
