import { describe, expect, it } from 'bun:test';
import {
	extractRawSql,
	parseWarnings,
	splitOutput,
} from './drizzle-output-parser';

describe('drizzle-output-parser', () => {
	describe('splitOutput', () => {
		it('should split output into preamble and sql section', () => {
			const input = `
Preamble text
--- Generated migration statements ---
CREATE TABLE foo;
`;
			const { preamble, sqlSection } = splitOutput(input);
			expect(preamble.trim()).toBe('Preamble text');
			expect(sqlSection.trim()).toBe('CREATE TABLE foo;');
		});

		it('should handle output without separator', () => {
			const input = 'Just preamble';
			const { preamble, sqlSection } = splitOutput(input);
			expect(preamble).toBe('Just preamble');
			expect(sqlSection).toBe('');
		});

		it('should strip ANSI codes before splitting', () => {
			const input = `\x1b[32mPreamble\x1b[0m\n--- Generated migration statements ---\n\x1b[31mSQL\x1b[0m`;
			const { preamble, sqlSection } = splitOutput(input);
			expect(preamble.trim()).toBe('Preamble');
			expect(sqlSection.trim()).toBe('SQL');
		});
	});

	describe('parseWarnings', () => {
		it('should parse explicit [warning] tags', () => {
			const input = `
[warning] This is a warning
Some other text
[warning] Another warning
`;
			const warnings = parseWarnings(input);
			expect(warnings).toEqual([
				'⚠️  This is a warning',
				'⚠️  Another warning',
			]);
		});

		it('should parse drizzle-kit warning section', () => {
			const input = `
⚠ Warning  There're potential data loss statements:
· You're about to delete non-empty "posts" table
· Another data loss warning
`;
			const warnings = parseWarnings(input);
			expect(warnings).toContain(
				'⚠️  You\'re about to delete non-empty "posts" table',
			);
			expect(warnings).toContain('⚠️  Another data loss warning');
		});

		it('should parse metadata changes (notNull)', () => {
			const input = `
│ notNull: false -> true
`;
			const warnings = parseWarnings(input);
			expect(warnings).toContain(
				'⚠️  POTENTIAL DATA LOSS: Adding NOT NULL constraint to column with existing NULL values',
			);
		});

		it('should parse metadata changes (type change)', () => {
			const input = `
│ type: integer -> smallint
`;
			const warnings = parseWarnings(input);
			expect(warnings).toContain(
				'⚠️  POTENTIAL DATA LOSS: Changing column type from integer to smallint may cause data loss',
			);
		});

		it('should parse column drops', () => {
			const input = `
│ column dropped
`;
			const warnings = parseWarnings(input);
			expect(warnings).toContain(
				'⚠️  POTENTIAL DATA LOSS: Dropping column will cause data loss',
			);
		});

		it('should fallback to keyword detection if no structure found', () => {
			const input = 'Something destructive happened here';
			const warnings = parseWarnings(input);
			expect(warnings).toContain(
				'⚠️  POTENTIAL DATA LOSS: Possible destructive changes or data loss detected.',
			);
		});
	});

	describe('extractRawSql', () => {
		it('should extract SQL statements and remove box drawing characters', () => {
			const input = `
│ CREATE TABLE "foo" (
│   "id" serial PRIMARY KEY
│ );
DROP TABLE "bar";
`;
			const statements = extractRawSql(input);
			expect(statements).toHaveLength(2);
			expect(statements[0]).toBe(
				'CREATE TABLE "foo" ( "id" serial PRIMARY KEY )',
			);
			expect(statements[1]).toBe('DROP TABLE "bar"');
		});

		it('should strip ANSI codes', () => {
			const input = `\x1b[32mCREATE TABLE foo\x1b[0m`;
			const statements = extractRawSql(input);
			expect(statements).toContain('CREATE TABLE foo');
		});

		it('should filter out non-SQL lines', () => {
			const input = `
Reading config file...
CREATE TABLE foo;
Done.
`;
			const statements = extractRawSql(input);
			expect(statements).toHaveLength(1);
			expect(statements[0]).toBe('CREATE TABLE foo');
		});

		it('should split multiple statements', () => {
			const input = 'CREATE TABLE foo; DROP TABLE bar;';
			const statements = extractRawSql(input);
			expect(statements).toEqual(['CREATE TABLE foo', 'DROP TABLE bar']);
		});
	});
});
