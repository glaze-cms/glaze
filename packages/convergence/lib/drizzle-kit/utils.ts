import { existsSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';

import type { Logger } from '@glaze/logger';

export const LIMITER = '--- Generated migration statements ---';

// Regex to match ANSI escape codes

const ANSI_REGEX = new RegExp(
	// eslint-disable-next-line no-control-regex
	'\\x1b\\[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]',
	'g',
);

export function stripAnsi(str: string): string {
	return str.replace(ANSI_REGEX, '');
}

/**
 * Handle drizzle-kit detection errors gracefully.
 * Logs error details and returns a safe fallback result.
 */
export function handleDetectionError(
	error: unknown,
	logger?: Logger,
): {
	hasDrift: true;
	warnings: string[];
} {
	if (error && typeof error === 'object' && 'stdout' in error) {
		const shellError = error as { stdout: Buffer; stderr: Buffer };
		const out = shellError.stdout.toString().trim();
		const err = shellError.stderr.toString().trim();
		if (out) logger?.error(`drizzle-kit stdout: ${out}`);
		if (err) logger?.error(`drizzle-kit stderr: ${err}`);
	} else {
		logger?.error({ err: error }, 'Failed to detect schema drift');
	}

	// Fallback: assume drift exists so we fall through to the runner
	// which can handle interactive prompts if needed
	return {
		hasDrift: true,
		warnings: ['Failed to detect drift - assuming changes exist'],
	};
}

export function validateDrizzleConfigPath(configPath: string): string {
	// Avoid passing surprising strings into a CLI arg.
	// This is not a shell injection vector (we use Bun.spawn with argv array),
	// but it helps prevent confusing behavior and accidental use of odd paths.
	if (/\0|\r|\n/.test(configPath)) {
		throw new Error('Invalid drizzle config path');
	}

	const trimmed = configPath.trim();
	if (!trimmed) {
		throw new Error('Invalid drizzle config path');
	}

	const normalized = isAbsolute(trimmed) ? trimmed : normalize(trimmed);

	if (!/(\.(c|m)?(j|t)s)$/.test(normalized)) {
		throw new Error(
			'Invalid drizzle config path extension. Expected .ts/.js/.mts/.cts/.mjs/.cjs',
		);
	}

	if (!existsSync(normalized)) {
		throw new Error('Drizzle config file not found');
	}

	return normalized;
}

/**
 * Detect whether drizzle-kit output likely contains an **interactive rename prompt**.
 */
export function looksLikeInteractiveRenamePrompt(output: string): boolean {
	// Keep this intentionally narrow to avoid false positives.
	const lines = output.split(/\r?\n/);
	for (const line of lines) {
		const lower = line.toLowerCase();
		if (!lower.includes('?')) continue;

		if (
			/\bcreated\s+or\s+renamed\b/.test(lower) &&
			/\b(column|table)\b/.test(lower)
		) {
			return true;
		}
	}

	return false;
}
