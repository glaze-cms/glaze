import { beforeEach, describe, expect, it, mock } from 'bun:test';

import {
	createCollection,
	dropCollection,
	renameCollection,
} from './collections';

// Mock DB
const mockExecute = mock(() => Promise.resolve({ rows: [] } as any));
const mockDb = { execute: mockExecute };

describe('collections', () => {
	beforeEach(() => {
		mockExecute.mockClear();
	});

	// ─── createCollection ──────────────────────────────────────────────────────

	describe('createCollection', () => {
		it('returns RESERVED_NAME for a reserved collection name without hitting the DB', async () => {
			const result = await createCollection(mockDb as never, {
				name: 'users',
				fields: [],
			});

			expect(result).toEqual({
				success: false,
				code: 'RESERVED_NAME',
				error: { collection: 'users' },
			});
			expect(mockExecute).toHaveBeenCalledTimes(0);
		});

		it('returns RESERVED_NAME for a reserved field name without hitting the DB', async () => {
			const result = await createCollection(mockDb as never, {
				name: 'articles',
				fields: [{ name: 'sessions', type: 'text' }],
			});

			expect(result).toEqual({
				success: false,
				code: 'RESERVED_NAME',
				error: { field: 'sessions' },
			});
			expect(mockExecute).toHaveBeenCalledTimes(0);
		});

		it('returns DUPLICATE_FIELD_NAME when two fields share the same name', async () => {
			const result = await createCollection(mockDb as never, {
				name: 'articles',
				fields: [
					{ name: 'title', type: 'text' },
					{ name: 'title', type: 'text' },
				],
			});

			expect(result).toEqual({
				success: false,
				code: 'DUPLICATE_FIELD_NAME',
				error: { field: 'title' },
			});
			expect(mockExecute).toHaveBeenCalledTimes(0);
		});

		it('returns COLLECTION_ALREADY_EXISTS when the table already exists', async () => {
			// tableExists → rows present
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

			const result = await createCollection(mockDb as never, {
				name: 'posts',
				fields: [],
			});

			expect(result).toEqual({
				success: false,
				code: 'COLLECTION_ALREADY_EXISTS',
				error: { collection: 'posts' },
			});
			// Only the tableExists check should have run — no final execute
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('creates the table and returns the SQL on success', async () => {
			// tableExists → empty (table does not exist)
			mockExecute.mockResolvedValueOnce({ rows: [] });
			// final db.execute → no meaningful return
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const result = await createCollection(mockDb as never, {
				name: 'articles',
				fields: [
					{ name: 'id', type: 'uuid', primaryKey: true },
					{ name: 'title', type: 'text', nullable: false },
				],
			});

			expect(result).toMatchObject({ success: true });
			if (!result.success) throw new Error('expected success');

			expect(result.sql).toContain('articles');
			expect(result.sql).toContain('id');
			expect(result.sql).toContain('title');
			expect(result.sql).toContain('CREATE TABLE');
			expect(mockExecute).toHaveBeenCalledTimes(2);
		});
	});

	// ─── renameCollection ──────────────────────────────────────────────────────

	describe('renameCollection', () => {
		it('returns COLLECTION_NOT_FOUND when the source table does not exist', async () => {
			// tableExists for source → empty
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const result = await renameCollection(mockDb as never, {
				collection: 'articles',
				newName: 'blog_posts',
			});

			expect(result).toEqual({
				success: false,
				code: 'COLLECTION_NOT_FOUND',
				error: { collection: 'articles' },
			});
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('returns RESERVED_NAME when the new name is reserved', async () => {
			// tableExists for source → exists
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

			const result = await renameCollection(mockDb as never, {
				collection: 'articles',
				newName: 'sessions',
			});

			expect(result).toEqual({
				success: false,
				code: 'RESERVED_NAME',
				error: { collection: 'sessions' },
			});
			// Only the source tableExists call — reserved-name check is synchronous
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('returns COLLECTION_ALREADY_EXISTS when the target table already exists', async () => {
			// tableExists for source → exists
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
			// tableExists for target → exists
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

			const result = await renameCollection(mockDb as never, {
				collection: 'articles',
				newName: 'blog_posts',
			});

			expect(result).toEqual({
				success: false,
				code: 'COLLECTION_ALREADY_EXISTS',
				error: { collection: 'blog_posts' },
			});
			expect(mockExecute).toHaveBeenCalledTimes(2);
		});

		it('renames the table and returns the SQL on success', async () => {
			// tableExists for source → exists
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
			// tableExists for target → empty (free)
			mockExecute.mockResolvedValueOnce({ rows: [] });
			// final db.execute
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const result = await renameCollection(mockDb as never, {
				collection: 'articles',
				newName: 'blog_posts',
			});

			expect(result).toMatchObject({ success: true });
			if (!result.success) throw new Error('expected success');

			expect(result.sql).toContain('ALTER TABLE');
			expect(result.sql).toContain('articles');
			expect(result.sql).toContain('blog_posts');
			expect(mockExecute).toHaveBeenCalledTimes(3);
		});
	});

	// ─── dropCollection ────────────────────────────────────────────────────────

	describe('dropCollection', () => {
		it('returns COLLECTION_NOT_FOUND when the source table does not exist', async () => {
			// tableExists → empty
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const result = await dropCollection(mockDb as never, {
				collection: 'articles',
			});

			expect(result).toEqual({
				success: false,
				code: 'COLLECTION_NOT_FOUND',
				error: { collection: 'articles' },
			});
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('returns COLLECTION_REFERENCED_BY_RELATION with referencing table names when FK references exist', async () => {
			// tableExists for source → exists
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
			// getTableReferences → one referencing table
			mockExecute.mockResolvedValueOnce({
				rows: [{ referencing_table: 'posts' }],
			});

			const result = await dropCollection(mockDb as never, {
				collection: 'articles',
			});

			expect(result).toEqual({
				success: false,
				code: 'COLLECTION_REFERENCED_BY_RELATION',
				error: { collection: 'articles', referencedBy: ['posts'] },
			});
			// tableExists + getTableReferences — no final execute
			expect(mockExecute).toHaveBeenCalledTimes(2);
		});

		it('drops the table and returns the SQL on success', async () => {
			// tableExists for source → exists
			mockExecute.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
			// getTableReferences → no referencing tables
			mockExecute.mockResolvedValueOnce({ rows: [] });
			// final db.execute
			mockExecute.mockResolvedValueOnce({ rows: [] });

			const result = await dropCollection(mockDb as never, {
				collection: 'articles',
			});

			expect(result).toMatchObject({ success: true });
			if (!result.success) throw new Error('expected success');

			expect(result.sql).toContain('DROP TABLE');
			expect(result.sql).toContain('articles');
			expect(mockExecute).toHaveBeenCalledTimes(3);
		});
	});
});
