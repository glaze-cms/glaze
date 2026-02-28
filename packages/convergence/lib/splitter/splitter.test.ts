import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { splitSchema } from './splitter';

describe('splitter', () => {
	let mockWrite: ReturnType<typeof mock>;

	beforeEach(() => {
		mockWrite = mock(() => Promise.resolve(42));
	});

	describe('splitSchema', () => {
		it('should split tables into separate files', async () => {
			const content = `
import { pgTable, text, serial } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
	id: serial("id").primaryKey(),
});

export const posts = pgTable("posts", {
	id: serial("id").primaryKey(),
});
`;

			const result = await splitSchema({
				content,
				outDir: '/tmp/out',
				writer: mockWrite,
			});

			expect(result.files).toHaveLength(3); // users.ts, posts.ts, index.ts
			expect(mockWrite).toHaveBeenCalledTimes(3);

			const calls = mockWrite.mock.calls;
			const getCall = (idx: number) => {
				const call = calls[idx];
				if (!call) throw new Error(`Call ${String(idx)} not found`);
				return call as unknown as [string, string];
			};

			const userCall = getCall(0);
			expect(userCall[0]).toContain('users.ts');
			expect(userCall[1]).toContain('Synced from database via Glaze Admin.');
			expect(userCall[1]).toContain('export const users');

			const postCall = getCall(1);
			expect(postCall[0]).toContain('posts.ts');
			expect(postCall[1]).toContain('export const posts');

			const indexCall = getCall(2);
			expect(indexCall[0]).toContain('index.ts');
			expect(indexCall[1]).toContain("export * from './users';");
			expect(indexCall[1]).toContain("export * from './posts';");
		});

		it('should include an enum only in files whose table references it', async () => {
			const content = `
import { pgEnum, pgTable } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "user"]);

export const users = pgTable("users", {
	role: roleEnum("role"),
});

export const posts = pgTable("posts", {
	id: text("id"),
});
`;
			await splitSchema({ content, outDir: '/tmp/out', writer: mockWrite });

			const calls = mockWrite.mock.calls as unknown as [string, string][];
			const usersCall = calls.find((c) => c[0].includes('users.ts'));
			const postsCall = calls.find((c) => c[0].includes('posts.ts'));
			if (!usersCall || !postsCall) throw new Error('Expected calls not found');

			expect(usersCall[1]).toContain('export const roleEnum');
			expect(postsCall[1]).not.toContain('export const roleEnum');
		});

		it('should include only the imports used by each table', async () => {
			const content = `
import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";
export const users = pgTable("users", {
	name: text("name"),
});
`;
			await splitSchema({ content, outDir: '/tmp/out', writer: mockWrite });

			const call = mockWrite.mock.calls[0] as unknown as
				| [string, string]
				| undefined;
			if (!call) throw new Error('Call not found');

			expect(call[1]).toContain('pgTable');
			expect(call[1]).toContain('text');
			expect(call[1]).not.toContain('integer');
			expect(call[1]).not.toContain('boolean');
		});

		it('should add reference imports', async () => {
			const content = `
export const posts = pgTable("posts", {
	authorId: integer("author_id").references(() => users.id),
});
`;
			await splitSchema({ content, outDir: '/tmp/out', writer: mockWrite });

			const call = mockWrite.mock.calls[0] as unknown as
				| [string, string]
				| undefined;
			if (!call) throw new Error('Call not found');

			expect(call[0]).toContain('posts.ts');
			expect(call[1]).toContain("import { users } from './users';");
		});

		it('should not add self-reference imports', async () => {
			const content = `
export const category = pgTable("category", {
	parentId: integer("parent_id").references(() => category.id),
});
`;
			await splitSchema({ content, outDir: '/tmp/out', writer: mockWrite });

			const call = mockWrite.mock.calls[0] as unknown as
				| [string, string]
				| undefined;
			if (!call) throw new Error('Call not found');

			expect(call[0]).toContain('category.ts');
			expect(call[1]).not.toContain("import { category } from './category';");
		});

		it('should extract and include indexes', async () => {
			const content = `
import { pgTable, text, serial, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
	id: serial("id").primaryKey(),
	email: text("email"),
}, (table) => {
	return {
		emailIdx: index("email_idx").on(table.email),
	};
});
`;
			await splitSchema({ content, outDir: '/tmp/out', writer: mockWrite });

			const call = mockWrite.mock.calls[0] as unknown as
				| [string, string]
				| undefined;
			if (!call) throw new Error('Call not found');

			expect(call[0]).toContain('users.ts');
			expect(call[1]).toContain('emailIdx: index("email_idx").on(table.email)');
			expect(call[1]).toContain('});');
		});
	});
});
