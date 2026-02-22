/**
 * Checks if a string is a valid SQL identifier (alphanumeric and underscores).
 * Supports schema-qualified names (e.g. "public"."users") and quoted identifiers.
 *
 * @param value - The string to check
 * @returns True if the string is a valid identifier
 */
export function isValidIdentifier(value: string): boolean {
	// Allow alphanumeric/underscore (unquoted) OR double-quoted strings (no quotes, no semicolons inside).
	// Hyphens are only valid inside double-quoted identifiers; unquoted identifiers cannot contain
	// hyphens in Postgres (the parser treats - as the subtraction operator).
	// Supports schema qualification (part.part)
	const segment = '([a-zA-Z0-9_]+|"[^";]+")';
	const pattern = new RegExp(`^${segment}(\\.${segment})*$`);

	return pattern.test(value);
}
