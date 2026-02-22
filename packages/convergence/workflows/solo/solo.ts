import { confirm, isCancel } from '@clack/prompts';

import { detectDriftFromSchema } from '../../engine/detector';
import { applyStatements } from '../../engine/executor';

import type { SoloWorkflowOptions } from '../../types/index';

/**
 * Runs the solo workflow (push mode).
 * Detects schema drift and applies changes directly to the database.
 *
 * @param options - Solo workflow options
 */
export async function runSoloWorkflow(
	options: SoloWorkflowOptions,
): Promise<void> {
	const { db, logger, config, connectionString, configPath } = options;
	const { destructive: destructionPolicy, validation: validationPolicy } =
		config;

	logger.debug('Running in Solo workflow (Push mode)');
	logger.info('Checking for schema drift...');

	// Detect drift
	const drift = await detectDriftFromSchema({
		connectionString,
		configPath,
		db,
		sync: {
			validation: validationPolicy,
			destructive: destructionPolicy,
		},
	});

	if (!drift.hasDrift) {
		if (drift.warnings && drift.warnings.length > 0) {
			for (const warning of drift.warnings) {
				logger.warn(warning);
			}
			logger.error(
				'Schema sync requires manual intervention. Server startup blocked.',
			);
			process.exit(1);
		}
		logger.info('✓ Schema is in sync with database');
		return;
	}

	logger.info(`Found ${String(drift.statements.length)} change(s)`);
	for (const summary of drift.summary) {
		logger.info(summary);
	}

	const hasDestructive = (drift.warnings?.length ?? 0) > 0;

	if (drift.warnings) {
		for (const warning of drift.warnings) {
			logger.warn(warning);
		}
	}

	// Handle destructive changes and validation strictness
	if (hasDestructive) {
		const isStrictValidation = validationPolicy === 'strict';
		const isDestructiveFail = destructionPolicy === 'fail';

		if (isStrictValidation || isDestructiveFail) {
			const reason = isStrictValidation
				? 'strict validation mode'
				: 'destructive mode set to "fail"';

			logger.error(
				`Updates blocked: Destructive changes detected in ${reason}.`,
			);
			process.exit(1);
		}
	}

	// Determine if we should apply
	if (destructionPolicy === 'ask') {
		if (!process.stdout.isTTY) {
			logger.warn(
				'destructive="ask" in a non-interactive environment — schema sync cancelled. ' +
					'Set destructive="apply" to apply changes automatically, or destructive="fail" to block on destructive changes.',
			);
			return;
		}

		const response = await confirm({
			message: `Apply ${String(drift.statements.length)} change(s)?`,
		});

		if (isCancel(response) || !response) {
			logger.info('Schema sync cancelled');
			return;
		}
	}

	// Apply changes
	// Reached here if:
	// 1. destructive='apply' (always apply)
	// 2. destructive='fail' (safe changes only - unsafe ones caused exit above)
	// 3. destructive='ask' (user confirmed)
	const result = await applyStatements({
		statements: drift.statements,
		db,
		logger,
	});

	if (!result.success) {
		logger.error('Failed to apply schema changes');
		process.exit(1);
	}

	logger.info('✓ Schema changes applied successfully');
}
