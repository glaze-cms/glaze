import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { scanTopLevelExports } from '../parser/index';

import type { Logger } from '@glaze/logger';

const CODEGEN_HEADER = `/**
 * Synced from database via Glaze Admin.
 * Indexes/constraints (including FKs) are preserved.
 *
 * For Drizzle's relational query API: create relations.ts
 * https://orm.drizzle.team/docs/relations-v2
 */`;

export interface SplitSchemaOptions {
	content: string;
	outDir: string;
	logger?: Logger;
	writer?: (path: string, content: string) => Promise<number>;
}

export interface SplitSchemaResult {
	files: string[];
}

function parseHeaderImports(header: string): Array<{ specifiers: string[]; from: string }> {
	const result: Array<{ specifiers: string[]; from: string }> = [];
	const re = /import\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(header)) !== null) {
		const specifiers = (m[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
		const from = m[2] ?? '';
		if (specifiers.length > 0 && from) result.push({ specifiers, from });
	}
	return result;
}

function buildImportsForContent(
	imports: Array<{ specifiers: string[]; from: string }>,
	fileContent: string,
): string {
	return imports
		.flatMap(({ specifiers, from }) => {
			const used = specifiers.filter((s) => new RegExp(`\\b${s}\\b`).test(fileContent));
			return used.length > 0 ? [`import { ${used.join(', ')} } from ${from}`] : [];
		})
		.join('\n');
}

/**
 * Splits a drizzle-kit pull output (single schema.ts) into per-table files.
 * Enum blocks are included in every file that needs them.
 * Generates an index.ts re-exporting all tables.
 */
export async function splitSchema({
	content,
	outDir,
	logger,
	writer,
}: SplitSchemaOptions): Promise<SplitSchemaResult> {
	const files: string[] = [];
	const performWrite = writer ?? ((p, c) => Bun.write(p, c));

	await mkdir(outDir, { recursive: true });

	const headerMatch = content.match(/^([\s\S]*?)(?=export)/);
	const rawHeader = headerMatch ? headerMatch[0].trim() : '';
	const parsedImports = parseHeaderImports(rawHeader);

	const blocks = scanTopLevelExports(content);

	const enumBlocks = blocks.filter((b) => b.match(/export const \w+ = pgEnum\(/));
	const enumContent = enumBlocks.join('\n\n');

	for (const block of blocks) {
		const isTable = block.match(/export const (\w+) = pgTable\(/);
		if (!isTable || !isTable[1]) continue;

		const tableName = isTable[1];

		const refs = [...block.matchAll(/\.references\(\(\)\s*=>\s*(\w+)\./g)]
			.map((r) => r[1])
			.filter((ref) => ref !== tableName);

		const refImports = [...new Set(refs)]
			.filter((ref): ref is string => ref !== undefined)
			.map((ref) => `import { ${ref} } from './${ref}';`)
			.join('\n');

		const fileContent = [enumContent, block.trim()].filter(Boolean).join('\n\n');
		const importLines = buildImportsForContent(parsedImports, fileContent);

		const parts: string[] = [CODEGEN_HEADER];
		if (importLines) parts.push(importLines);
		if (refImports) parts.push(refImports);
		if (enumContent) parts.push(enumContent);
		parts.push('');
		parts.push(block.trim());

		const filePath = join(outDir, `${tableName}.ts`);
		await performWrite(filePath, parts.join('\n'));
		files.push(filePath);
		logger?.debug(`Created ${filePath}`);
	}

	const exports = files
		.map((f) => {
			const name = f.split('/').pop()?.replace('.ts', '') ?? '';
			return `export * from './${name}';`;
		})
		.join('\n');

	const indexPath = join(outDir, 'index.ts');
	await performWrite(indexPath, `${CODEGEN_HEADER}\n${exports}`);
	files.push(indexPath);

	logger?.info(`Split schema into ${String(files.length)} files in ${outDir}`);

	return { files };
}
