import { isValidIdentifier } from '@glaze/shared';
import { sql } from 'drizzle-orm';

/**
 * Checks whether a SQL keyword appears in the input **outside** of quoted strings
 * and quoted identifiers.
 *
 * This is a small tokenizer-style helper used to avoid false positives from naive
 * substring searches like `sql.toUpperCase().includes('DEFAULT')`.
 *
 * **What it skips:**
 * - Single-quoted string literals: `'...'` (supports Postgres escaping via doubled quotes: `''`)
 * - Double-quoted identifiers: `"..."` (supports escaping via doubled quotes: `""`)
 *
 * **What it detects:**
 * - Case-insensitive matches of `keyword` with identifier boundaries, meaning
 *   it will match `DEFAULT` but not `DEFAULTS` or `MYDEFAULT`.
 *
 * **Limitations (intentional for our drizzle-kit output use-case):**
 * - Does not parse SQL comments (line comments like `-- ...` or block comments)
 * - Does not handle Postgres dollar-quoted strings (`$$...$$`, `$tag$...$tag$`)
 * - Does not understand SQL grammar; it is only a conservative filter
 */
export function containsUnquotedKeyword(
	input: string,
	keyword: string,
): boolean {
	const kw = keyword.toLowerCase();
	const kwLen = kw.length;

	let inSingleQuote = false;
	let inDoubleQuote = false;

	const isIdentChar = (ch: string) => /[a-zA-Z0-9_]/.test(ch);

	for (let i = 0; i < input.length; i++) {
		const ch = input[i] as string;
		const next = input[i + 1] ?? '';

		if (inSingleQuote) {
			// Postgres escapes single quotes by doubling them
			if (ch === "'") {
				if (next === "'") {
					i++;
					continue;
				}
				inSingleQuote = false;
			}
			continue;
		}

		if (inDoubleQuote) {
			// Identifiers escape double quotes by doubling them
			if (ch === '"') {
				if (next === '"') {
					i++;
					continue;
				}
				inDoubleQuote = false;
			}
			continue;
		}

		if (ch === "'") {
			inSingleQuote = true;
			continue;
		}

		if (ch === '"') {
			inDoubleQuote = true;
			continue;
		}

		// Check keyword match (case-insensitive) at this position with identifier boundaries
		if (i + kwLen <= input.length) {
			const slice = input.slice(i, i + kwLen).toLowerCase();
			if (slice === kw) {
				const prevChar = i > 0 ? (input[i - 1] as string) : '';
				const nextChar = input[i + kwLen] ?? '';
				const leftBoundary = !prevChar || !isIdentChar(prevChar);
				const rightBoundary = !nextChar || !isIdentChar(nextChar);
				if (leftBoundary && rightBoundary) return true;
			}
		}
	}

	return false;
}

export function sqlIdentifier(raw: string) {
	if (!isValidIdentifier(raw)) {
		throw new Error(`Invalid identifier: ${raw}`);
	}

	// We use sql.raw because sql.identifier does not support qualified names (e.g. "schema"."table").
	// This is safe because isValidIdentifier strictly validates the string structure.
	return sql.raw(raw);
}
