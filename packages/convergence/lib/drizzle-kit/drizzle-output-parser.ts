import { LIMITER, stripAnsi } from './utils';

/**
 * Split drizzle-kit push --explain output into preamble and SQL section.
 */
export function splitOutput(output: string): {
	preamble: string;
	sqlSection: string;
} {
	const cleanOutput = stripAnsi(output);
	const parts = cleanOutput.split(LIMITER);
	return {
		preamble: parts[0] ?? '',
		sqlSection: parts[1] ?? '',
	};
}

/**
 * Parse warnings from drizzle-kit output.
 * Looks for [warning] tags AND analyzes metadata to detect destructive changes.
 *
 * drizzle-kit doesn't always emit [warning] tags, but shows metadata in box-drawing lines:
 * │ notNull: false -> true
 * │ type: integer -> smallint
 *
 * Also catches drizzle-kit's own warnings:
 * ⚠ Warning  There're potential data loss statements:
 * · You're about to delete non-empty excerpt column in "posts" table
 */
export function parseWarnings(preamble: string): string[] {
	const warnings: string[] = [];

	// Look for explicit [warning] tags
	const warningRegex = /\[warning\]\s+(.+)/gi;
	let match;
	while ((match = warningRegex.exec(preamble)) !== null) {
		if (match[1]) warnings.push(`⚠️  ${match[1].trim()}`);
	}

	// Look for drizzle-kit's "Warning" header and data loss statements
	const lines = preamble.split('\n');
	let inWarningSection = false;

	for (const line of lines) {
		// Detect warning section start
		if (line.includes('Warning') && line.includes('potential data loss')) {
			inWarningSection = true;
			continue;
		}

		// Parse warning items (lines starting with ·)
		if (inWarningSection && line.trim().startsWith('·')) {
			const warningText = line.replace(/^[·\s]+/, '').trim();
			warnings.push(`⚠️  ${warningText}`);
		}

		// Exit warning section on empty line or new section
		if (inWarningSection && line.trim() === '') {
			inWarningSection = false;
		}
	}

	// Parse metadata from box-drawing section to detect destructive changes
	const metadataLines = preamble
		.split('\n')
		.filter((line) => line.trim().startsWith('│'))
		.map((line) => line.replace(/^[│├└┌─\s]+/, '').trim());

	for (const line of metadataLines) {
		// Detect SET NOT NULL (adding NOT NULL constraint)
		if (line.match(/notNull:\s*false\s*->\s*true/i)) {
			warnings.push(
				'⚠️  POTENTIAL DATA LOSS: Adding NOT NULL constraint to column with existing NULL values',
			);
		}

		// Detect type changes (potential data loss)
		const typeMatch = line.match(/type:\s*(\w+)\s*->\s*(\w+)/i);
		if (typeMatch && typeMatch[1] && typeMatch[2]) {
			warnings.push(
				`⚠️  POTENTIAL DATA LOSS: Changing column type from ${typeMatch[1]} to ${typeMatch[2]} may cause data loss`,
			);
		}

		// Detect column drops
		if (line.match(/column\s+dropped/i) || line.includes('DROP COLUMN')) {
			warnings.push(
				'⚠️  POTENTIAL DATA LOSS: Dropping column will cause data loss',
			);
		}
	}

	// Fallback: check for destructive keywords in preamble
	if (warnings.length === 0) {
		const lowerPreamble = preamble.toLowerCase();
		if (
			lowerPreamble.includes('destructive') ||
			lowerPreamble.includes('data loss')
		) {
			warnings.push(
				'⚠️  POTENTIAL DATA LOSS: Possible destructive changes or data loss detected.',
			);
		}
	}

	// De-dupe while preserving order
	return [...new Set(warnings)];
}

/**
 * Extracts raw SQL statements from drizzle-kit's formatted output.
 * Removes box-drawing characters and metadata lines.
 * Reconstructs multi-line SQL statements properly.
 */
export function extractRawSql(formattedOutput: string): string[] {
	const SQL_KEYWORDS =
		/^(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|SET|ADD|REMOVE)/i;
	const BOX_DRAWING_PREFIX = /^[│├└┌─\s]+/;

	// Clean up each line but keep track of structure
	const lines = stripAnsi(formattedOutput)
		.split('\n')
		.map((line) => line.replace(BOX_DRAWING_PREFIX, '').trim());

	// Reconstruct SQL statements (they may span multiple lines)
	const statements: string[] = [];
	let currentStatement = '';
	let parenDepth = 0;

	for (const line of lines) {
		// Skip truly empty lines when not building a statement
		if (!line && !currentStatement) {
			continue;
		}

		// If we're in a statement, even ")" or ");" matters
		if (currentStatement && line) {
			currentStatement += ' ' + line;
		}
		// Start of a new statement
		else if (SQL_KEYWORDS.test(line) && !currentStatement) {
			currentStatement = line;
		}
		// Skip non-SQL lines when not in a statement
		else if (!currentStatement) {
			continue;
		}

		// Track parenthesis depth for the current line
		for (const char of line) {
			if (char === '(') parenDepth++;
			if (char === ')') parenDepth--;
		}

		// Check if statement is complete
		// 1. Ends with semicolon
		if (currentStatement.includes(';')) {
			const parts = currentStatement.split(';');
			for (let i = 0; i < parts.length - 1; i++) {
				const stmt = parts[i]?.trim();
				if (stmt) statements.push(stmt);
			}
			currentStatement = parts[parts.length - 1]?.trim() ?? '';
			parenDepth = 0;
		}
		// 2. CREATE TABLE/CREATE INDEX/ALTER TABLE statements are complete when parens are balanced
		else if (
			parenDepth === 0 &&
			currentStatement &&
			(currentStatement.match(/^CREATE\s+(TABLE|INDEX)/i) ||
				currentStatement.match(/^ALTER\s+TABLE/i))
		) {
			statements.push(currentStatement.trim());
			currentStatement = '';
		}
	}

	// Add any remaining statement
	if (currentStatement.trim()) {
		statements.push(currentStatement.trim());
	}

	return statements;
}
