import { expect, test } from '#harness';
import { createLogger } from '#logger';

import { parseEnv, validateEnv } from './env.ts';

/** The Glaze-owned env vars a test may set; cleared before each run so the process env can't leak in. */
const MANAGED = [
	'NODE_ENV',
	'GLAZE_AUTH_SECRET',
	'GLAZE_AUTH_URL',
	'GLAZE_SETUP_TOKEN',
	'GLAZE_PORT',
	'PORT',
] as const;

/**
 * Runs `fn` with a hermetic environment: the managed vars are cleared, `overrides` applied, then the
 * prior values restored afterward regardless of outcome.
 *
 * @param overrides - The env values to set for the duration of `fn`.
 * @param fn - The body to run under the overridden environment.
 * @returns Whatever `fn` returns.
 */
function withEnv<T>(overrides: Partial<Record<(typeof MANAGED)[number], string>>, fn: () => T): T {
	const saved = new Map(MANAGED.map((key) => [key, process.env[key]]));
	for (const key of MANAGED) delete process.env[key];
	Object.assign(process.env, overrides);
	try {
		return fn();
	} finally {
		for (const key of MANAGED) {
			const value = saved.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

/** The variables named in a failed parse, for terse assertions. */
function failedVariables(overrides: Partial<Record<(typeof MANAGED)[number], string>>): string[] {
	return withEnv(overrides, () => {
		const result = parseEnv();
		return result.success ? [] : result.errors.map((error) => error.variable);
	});
}

const silent = createLogger({ level: 'silent' });

test('parseEnv applies defaults when nothing is set', () => {
	const env = withEnv({}, () => {
		const result = parseEnv();
		if (!result.success) throw new Error('expected success');
		return result.env;
	});
	expect(env.NODE_ENV).toBe('development');
	expect(env.GLAZE_PORT).toBe(4000);
});

test('parseEnv accepts a fully valid production environment', () => {
	const env = withEnv(
		{
			NODE_ENV: 'production',
			GLAZE_AUTH_SECRET: 'k'.repeat(40),
			GLAZE_AUTH_URL: 'https://cms.example.com',
			GLAZE_PORT: '8080',
		},
		() => {
			const result = parseEnv();
			if (!result.success)
				throw new Error(`expected success, got ${JSON.stringify(result.errors)}`);
			return result.env;
		},
	);
	expect(env.GLAZE_PORT).toBe(8080);
	expect(env.NODE_ENV).toBe('production');
});

test('parseEnv coerces GLAZE_PORT and honors the PORT fallback', () => {
	const env = withEnv({ PORT: '3000' }, () => {
		const result = parseEnv();
		if (!result.success) throw new Error('expected success');
		return result.env;
	});
	expect(env.GLAZE_PORT).toBe(3000);
});

test('parseEnv rejects a too-short auth secret in any environment', () => {
	expect(failedVariables({ GLAZE_AUTH_SECRET: 'short' })).toContain('GLAZE_AUTH_SECRET');
});

test('parseEnv rejects an out-of-range port', () => {
	expect(failedVariables({ GLAZE_PORT: '70000' })).toContain('GLAZE_PORT');
});

test('parseEnv rejects a non-numeric port', () => {
	expect(failedVariables({ GLAZE_PORT: 'abc' })).toContain('GLAZE_PORT');
});

test('parseEnv rejects a malformed auth URL', () => {
	expect(failedVariables({ GLAZE_AUTH_URL: 'ftp://nope' })).toContain('GLAZE_AUTH_URL');
});

test('parseEnv rejects a too-short setup token', () => {
	expect(failedVariables({ GLAZE_SETUP_TOKEN: 'short' })).toContain('GLAZE_SETUP_TOKEN');
});

test('parseEnv accepts a setup token of the minimum length and treats a blank one as unset', () => {
	expect(failedVariables({ GLAZE_SETUP_TOKEN: 't'.repeat(16) })).toEqual([]);
	expect(failedVariables({ GLAZE_SETUP_TOKEN: '   ' })).toEqual([]);
});

test('parseEnv rejects an unknown NODE_ENV', () => {
	expect(failedVariables({ NODE_ENV: 'prod' })).toContain('NODE_ENV');
});

test('parseEnv requires the auth secret in production', () => {
	expect(failedVariables({ NODE_ENV: 'production' })).toContain('GLAZE_AUTH_SECRET');
});

// A blank value (as copied from .env.example) must read as unset, not as an empty string that fails
// the length check — so it keeps the dev fallback in dev, and still errors as "required" in production.
test('parseEnv treats a blank auth secret as unset', () => {
	expect(failedVariables({ GLAZE_AUTH_SECRET: '   ' })).toEqual([]);
	expect(failedVariables({ NODE_ENV: 'production', GLAZE_AUTH_SECRET: '' })).toContain(
		'GLAZE_AUTH_SECRET',
	);
});

test('every error carries an actionable hint', () => {
	const hints = withEnv({ GLAZE_PORT: 'abc' }, () => {
		const result = parseEnv();
		return result.success ? [] : result.errors.map((error) => error.hint);
	});
	expect(hints).toHaveLength(1);
	expect(hints[0]).toContain('GLAZE_PORT');
});

test('validateEnv returns the typed env when valid', () => {
	const env = withEnv({}, () => validateEnv(silent));
	expect(env.NODE_ENV).toBe('development');
});

test('validateEnv throws when the environment is invalid', () => {
	const threw = withEnv({ GLAZE_PORT: 'abc' }, () => {
		try {
			validateEnv(silent);
			return false;
		} catch {
			return true;
		}
	});
	expect(threw).toBe(true);
});
