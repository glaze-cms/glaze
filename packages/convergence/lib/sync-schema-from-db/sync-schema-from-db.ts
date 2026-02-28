import {
	introspectToSchema,
	type IntrospectDbOptions,
} from '../introspect-db/index';
import {
	splitSchema,
	type SplitSchemaOptions,
	type SplitSchemaResult,
} from '../splitter/index';

export interface SyncSchemaOptions {
	introspector?: (
		connectionString: string,
		options?: IntrospectDbOptions,
	) => Promise<string>;
	splitter?: (options: SplitSchemaOptions) => Promise<SplitSchemaResult>;
}

/**
 * Introspects the live database with drizzle-kit pull, then splits the resulting
 * schema.ts into per-table files in outDir.
 */
export async function syncSchemaFromDB(
	connectionString: string,
	outDir: string,
	options: SyncSchemaOptions = {},
): Promise<string[]> {
	const introspect = options.introspector ?? introspectToSchema;
	const split = options.splitter ?? splitSchema;

	const schemaCode = await introspect(connectionString);
	const { files } = await split({ content: schemaCode, outDir });

	return files;
}
