/**
 * Scans content and extracts top-level `export const` blocks using a state machine.
 * Correctly handles brackets, strings, and comments so they don't split blocks early.
 */
export function scanTopLevelExports(content: string): string[] {
	const blocks: string[] = [];
	let currentBlock = '';
	let inBlock = false;
	let depth = 0;

	let inSingleComment = false;
	let inMultiComment = false;
	let inString: null | "'" | '"' | '`' = null;

	for (let i = 0; i < content.length; i++) {
		const char = content[i] as string;
		const next = content[i + 1] ?? '';

		if (!inString && !inMultiComment && !inSingleComment) {
			if (char === '/' && next === '/') {
				inSingleComment = true;
				i++;
				if (inBlock) currentBlock += '//';
				continue;
			}
			if (char === '/' && next === '*') {
				inMultiComment = true;
				i++;
				if (inBlock) currentBlock += '/*';
				continue;
			}
			if (char === '"' || char === "'" || char === '`') {
				inString = char;
				if (inBlock) currentBlock += char;
				continue;
			}
		} else if (inSingleComment) {
			if (char === '\n') inSingleComment = false;
			if (inBlock) currentBlock += char;
			continue;
		} else if (inMultiComment) {
			if (char === '*' && next === '/') {
				inMultiComment = false;
				i++;
				if (inBlock) currentBlock += '*/';
				continue;
			}
			if (inBlock) currentBlock += char;
			continue;
		} else if (inString) {
			if (char === '\\') {
				if (inBlock) {
					currentBlock += char;
					currentBlock += next;
				}
				i++;
				continue;
			}
			if (char === inString) inString = null;
			if (inBlock) currentBlock += char;
			continue;
		}

		if (!inBlock) {
			if (char === 'e' && content.substring(i, i + 13) === 'export const ') {
				inBlock = true;
				currentBlock = 'export const ';
				i += 12;
				continue;
			}
		} else {
			currentBlock += char;
			if (char === '{') depth++;
			if (char === '}') depth--;

			if (char === ';' && depth === 0) {
				blocks.push(currentBlock);
				currentBlock = '';
				inBlock = false;
			}
		}
	}

	return blocks;
}
