import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { mergeConfig } from '@glaze/shared';
import { runSoloWorkflow } from './workflows/solo';

import type { ConvergenceOptions } from './types/index';

export async function runConvergence({
	config,
	db,
	logger,
	connectionString,
	glazeSchemaPath,
}: ConvergenceOptions): Promise<void> {
	if (config.enabled === false) return;

	if (config.workflow === 'solo') {
		const userConfigPath = config.solo?.configPath ?? 'drizzle.config.ts';
		const mergedConfigPath = await mergeConfig({
			userConfigPath,
			glazeSchemaPath,
		});

		try {
			await runSoloWorkflow({
				db,
				logger,
				config: config.solo ?? {},
				connectionString,
				configPath: mergedConfigPath,
			});
		} finally {
			await rm(dirname(mergedConfigPath), { recursive: true, force: true });
		}
	}
}
