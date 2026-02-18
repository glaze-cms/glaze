import { runSoloWorkflow } from './workflows/solo';

import type { ConvergenceOptions } from './types/index';

export async function runConvergence({
	config,
	db,
	logger,
	connectionString,
}: ConvergenceOptions): Promise<void> {
	if (config.enabled === false) return;

	if (config.workflow === 'solo') {
		await runSoloWorkflow({
			db,
			logger,
			config: config.solo ?? {},
			connectionString,
			configPath: 'drizzle.config.ts',
		});
	}
}
