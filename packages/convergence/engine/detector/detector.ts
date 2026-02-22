/**
 * Detects schema drift between the current schema and the database.
 *
 * Uses drizzle-kit's programmatic API to compare schema definitions
 * against the live database state.
 */
import {
	splitOutput,
	extractRawSql,
	parseWarnings,
} from '../../lib/drizzle-kit/drizzle-output-parser';
import {
	validateDrizzleConfigPath,
	looksLikeInteractiveRenamePrompt,
} from '../../lib/drizzle-kit/utils';
import { validateDataConstraints } from '../../lib/validator';

import type { DriftResult, DetectDriftOptions } from '../../types/index';

/**
 * Detects drift between the schema defined in the drizzle config and the database.
 *
 * Runs drizzle-kit push --explain to introspect the live DB and compare against the schema.
 * No snapshot files are used - the DB is introspected on every call.
 *
 * @param options - Detection options
 * @returns DriftResult with statements, summary, and current snapshot
 */
export async function detectDriftFromSchema(
	options: DetectDriftOptions,
): Promise<DriftResult> {
	const { connectionString, db, interactive } = options;

	try {
		const configPath = validateDrizzleConfigPath(options.configPath);

		const proc = Bun.spawn(
			['bunx', 'drizzle-kit', 'push', '--explain', `--config=${configPath}`],
			{
				env: {
					...process.env,
					DATABASE_URL: connectionString,
					CI: 'true',
				},
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		);

		const [output, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		await proc.exited;

		if (proc.exitCode !== 0) {
			throw new Error(
				`Drift detection failed (exit code ${String(proc.exitCode)}): ${stderr}\n${output}`,
			);
		}

		// Parse output
		const { preamble, sqlSection } = splitOutput(output);
		const statements = extractRawSql(sqlSection);
		const warnings = parseWarnings(preamble);

		const hasDrift = statements.length > 0;
		const summary = statements.map(
			(s) => `• ${s.slice(0, 80)}${s.length > 80 ? '...' : ''}`,
		);

		// Run custom data validation if DB instance is provided
		if (db && hasDrift) {
			const validationWarnings = await validateDataConstraints(
				db,
				statements,
			);
			if (validationWarnings.length > 0) {
				warnings.push(...validationWarnings);
			}
		}

		// De-dupe warnings after merging
		const dedupedWarnings = [...new Set(warnings)];

		// Check for ambiguous output (e.g., interactive prompts for renames)
		const isAmbiguous =
			statements.length === 0 && looksLikeInteractiveRenamePrompt(output);

		if (isAmbiguous) {
			const isInteractive = interactive ?? process.stdout.isTTY;

			const allowFallback =
				isInteractive &&
				options.sync?.validation !== 'strict' &&
				options.sync?.destructive !== 'fail';

			if (allowFallback) {
				// Fallback: Run push interactively to let user handle prompts
				const fallbackProc = Bun.spawn(
					['bunx', 'drizzle-kit', 'push', `--config=${configPath}`],
					{
						env: {
							...process.env,
							DATABASE_URL: connectionString,
							CI: 'false',
						},
						stdin: 'inherit',
						stdout: 'inherit',
						stderr: 'inherit',
					},
				);

				await fallbackProc.exited;

				if (fallbackProc.exitCode !== 0) {
					throw new Error(
						`Interactive push failed (exit code ${String(fallbackProc.exitCode)})`,
					);
				}

				// Return as "no drift" because changes are already applied
				return {
					hasDrift: false,
					statements: [],
					summary: [],
					currentSnapshot: {},
					warnings: [],
				};
			} else {
				dedupedWarnings.push(
					'Ambiguous schema change (rename vs drop/create) detected. Manual intervention required.',
				);
			}
		}

		return {
			hasDrift,
			statements,
			summary,
			currentSnapshot: {},
			warnings: dedupedWarnings,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new Error(`Drift detection failed: ${msg}`);
	}
}
