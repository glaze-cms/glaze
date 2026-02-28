import { describe, expect, it } from 'bun:test';
import { scanTopLevelExports } from './parser';

describe('parser', () => {
	describe('scanTopLevelExports', () => {
		it('should identify simple export const blocks', () => {
			const input = `
export const user = pgTable("user", {
	id: serial("id").primaryKey(),
});

export const post = pgTable("post", {
	id: serial("id").primaryKey(),
});
`;
			const blocks = scanTopLevelExports(input);
			expect(blocks).toHaveLength(2);
			expect(blocks[0]).toContain('export const user');
			expect(blocks[1]).toContain('export const post');
		});

		it('should handle nested braces correctly', () => {
			const input = `
export const complex = pgTable("complex", {
	json: jsonb("json").default({ foo: "bar" }),
});
`;
			const blocks = scanTopLevelExports(input);
			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toContain('export const complex');
			expect(blocks[0]).toContain('{ foo: "bar" }');
		});

		it('should ignore keywords inside strings', () => {
			const input = `
export const stringy = pgTable("stringy", {
	text: text("content").default("export const fake = ...;"),
});
`;
			const blocks = scanTopLevelExports(input);
			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toContain('export const stringy');
			expect(blocks[0]).toContain('fake = ...');
		});

		it('should ignore keywords inside single-line comments', () => {
			const input = `
// export const commented = ...;
export const real = pgTable("real", {});
`;
			const blocks = scanTopLevelExports(input);
			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toContain('export const real');
		});

		it('should ignore keywords inside multi-line comments', () => {
			const input = `
/*
export const commented = ...;
*/
export const real = pgTable("real", {});
`;
			const blocks = scanTopLevelExports(input);
			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toContain('export const real');
		});

		it('should handle escaped quotes in strings', () => {
			const input = `
export const escaped = pgTable("escaped", {
	val: text("val").default("He said \\"hello\\""),
});
`;
			const blocks = scanTopLevelExports(input);
			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toContain('He said \\"hello\\"');
		});

		it('should handle template literals', () => {
			const input = `
export const tmpl = pgTable("tmpl", {
	val: text("val").default(\`
		Some multiline string
		with { braces }
	\`),
});
`;
			const blocks = scanTopLevelExports(input);
			expect(blocks).toHaveLength(1);
			expect(blocks[0]).toContain('Some multiline string');
		});
	});
});
