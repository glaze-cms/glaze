export interface TemplateOptions {
	projectName: string;
	includeExampleSchema: boolean;
	databaseUrl: string;
	authSecret: string;
}

export function getTemplateFiles(
	options: TemplateOptions,
): Record<string, string> {
	const { projectName, includeExampleSchema, databaseUrl, authSecret } =
		options;

	const files: Record<string, string> = {
		'package.json': JSON.stringify(
			{
				name: projectName,
				private: true,
				type: 'module',
				scripts: {
					dev: 'bun --bun --watch index.ts',
					start: 'bun --bun dist/index.js',
					build: 'bun build ./index.ts --outdir dist --target bun',
				},
				dependencies: {
					'@glaze/cms': 'latest',
				},
				devDependencies: {
					'@types/bun': 'latest',
				},
			},
			null,
			'\t',
		),

		'index.ts': includeExampleSchema
			? `import { glaze } from '@glaze/cms';
import * as schema from './schema';

await glaze({
\tconfig: {
\t\tschema,
\t},
});
`
			: `import { glaze } from '@glaze/cms';

await glaze({
\tconfig: {
\t\tschema: {},
\t},
});
`,

		'tsconfig.json': JSON.stringify(
			{
				compilerOptions: {
					lib: ['ESNext'],
					target: 'ESNext',
					module: 'Preserve',
					strict: true,
					outDir: 'dist',
					types: ['bun'],
				},
				include: ['*.ts', '**/*.ts'],
			},
			null,
			'\t',
		),

		'.env': `# Server Config
GLAZE_PORT=4000

# Database
GLAZE_DATABASE_URL=${databaseUrl}

# Auth (auto-generated)
GLAZE_AUTH_SECRET=${authSecret}
`,
	};

	if (includeExampleSchema) {
		files['drizzle.config.ts'] = `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
\tschema: './schema/index.ts',
\tdialect: 'postgresql',
\tout: './drizzle',
\tdbCredentials: {
\t\turl: (process.env.GLAZE_DATABASE_URL ?? process.env.DATABASE_URL) as string,
\t},
});
`;

		files['schema/index.ts'] = `export * from './posts';
export * from './authors';
`;

		files['schema/posts.ts'] = `import {
\tpgTable,
\tuuid,
\ttext,
\ttimestamp,
\tunique,
\tinteger,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const posts = pgTable(
\t'posts',
\t{
\t\tid: uuid().defaultRandom().primaryKey(),
\t\ttitle: text().notNull(),
\t\tslug: text().notNull(),
\t\tcontent: text().notNull(),
\t\tstatus: text().default('draft'),
\t\tcreatedAt: timestamp('created_at').default(sql\`now()\`),
\t\tupdatedAt: timestamp('updated_at').default(sql\`now()\`),
\t\tauthorId: uuid('author_id').notNull(),
\t\tsoftDeletedAt: timestamp('soft_deleted_at'),
\t\tviews: integer('views').default(0),
\t},
\t(table) => [unique('posts_slug_key').on(table.slug)],
);
`;

		files['schema/authors.ts'] = `import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const authors = pgTable('authors', {
\tid: uuid().defaultRandom().primaryKey(),
\tname: text().notNull(),
\temail: text().notNull(),
\tbio: text(),
\tcreatedAt: timestamp('created_at').default(sql\`now()\`),
\tupdatedAt: timestamp('updated_at').default(sql\`now()\`),
});
`;
	}

	return files;
}
