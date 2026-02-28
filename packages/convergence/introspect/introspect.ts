import { syncSchemaFromDB as defaultSyncSchemaFromDB } from '../lib/sync-schema-from-db/index';

import type { Logger } from '@glaze/logger';

export interface IntrospectOptions {
	connectionString: string;
	schemaOutDir: string;
	logger: Logger;
	syncSchema?: (connectionString: string, outDir: string) => Promise<string[]>;
}

/**
 * Runs drizzle-kit pull + schema splitting in the background after a successful
 * admin schema operation. Non-blocking — the admin gets their response immediately.
 */
export function runIntrospectionInBackground({
	connectionString,
	schemaOutDir,
	logger,
	syncSchema = defaultSyncSchemaFromDB,
}: IntrospectOptions): void {
	syncSchema(connectionString, schemaOutDir).then(
		(files) => {
			logger.debug(
				`Schema sync complete: ${String(files.length)} files written`,
			);
		},
		(err: unknown) => {
			logger.warn(
				`Background schema sync failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		},
	);
}
