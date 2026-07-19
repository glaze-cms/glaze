/**
 * Reports whether a string is a valid SQL identifier.
 *
 * Accepts unquoted alphanumeric/underscore names and double-quoted identifiers, and supports
 * schema qualification (`schema.table`). Unquoted hyphens are rejected — Postgres parses `-`
 * as the subtraction operator, so hyphens are only valid inside double quotes.
 *
 * @param value - The candidate identifier.
 * @returns `true` when the string is a well-formed identifier.
 *
 * @example
 * ```ts
 * isValidIdentifier('public.users'); // → true
 * isValidIdentifier('drop table');   // → false
 * ```
 */
export function isValidIdentifier(value: string): boolean {
	const segment = '([a-zA-Z0-9_]+|"[^";]+")';
	const pattern = new RegExp(`^${segment}(\\.${segment})*$`);

	return pattern.test(value);
}
