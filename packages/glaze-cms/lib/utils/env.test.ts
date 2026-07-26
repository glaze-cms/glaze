import { expect, test } from '#harness';

import { isEnvFlagEnabled } from './env.ts';

const FLAG = 'GLAZE_TEST_FLAG_X';

/**
 * Runs `fn` with `FLAG` set to `value` (or cleared when `undefined`), restoring the prior value after.
 *
 * @param value - The flag value to set, or `undefined` to leave it unset.
 * @param fn - The body to run.
 * @returns Whatever `fn` returns.
 */
function withFlag<T>(value: string | undefined, fn: () => T): T {
	const saved = process.env[FLAG];
	if (value === undefined) delete process.env[FLAG];
	else process.env[FLAG] = value;
	try {
		return fn();
	} finally {
		if (saved === undefined) delete process.env[FLAG];
		else process.env[FLAG] = saved;
	}
}

test('isEnvFlagEnabled is false when the variable is unset', () => {
	expect(withFlag(undefined, () => isEnvFlagEnabled(FLAG))).toBe(false);
});

test('isEnvFlagEnabled reads truthy values as enabled', () => {
	for (const value of ['1', 'true', 'yes', 'on', 'anything']) {
		expect(withFlag(value, () => isEnvFlagEnabled(FLAG))).toBe(true);
	}
});

test('isEnvFlagEnabled reads explicit-off values as disabled', () => {
	for (const value of ['', '0', 'false', 'no', 'off']) {
		expect(withFlag(value, () => isEnvFlagEnabled(FLAG))).toBe(false);
	}
});

test('isEnvFlagEnabled ignores surrounding whitespace and case', () => {
	expect(withFlag('  TRUE  ', () => isEnvFlagEnabled(FLAG))).toBe(true);
	expect(withFlag('  False ', () => isEnvFlagEnabled(FLAG))).toBe(false);
});
