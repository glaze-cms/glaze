import { expect, test } from '#harness';
import { createLogger } from '#logger';

import { resolveAuthSecret } from './secret.ts';

const silent = createLogger({ level: 'silent' });

/** Runs `fn` with `env` applied to `process.env`, restoring the prior values afterward. */
function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
	const saved: Record<string, string | undefined> = {};
	for (const key of Object.keys(env)) {
		saved[key] = process.env[key];
		const value = env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		fn();
	} finally {
		for (const key of Object.keys(saved)) {
			const value = saved[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test('resolveAuthSecret returns the configured secret when set', () => {
	withEnv({ GLAZE_AUTH_SECRET: 'a-real-long-random-secret' }, () => {
		expect(resolveAuthSecret(silent)).toBe('a-real-long-random-secret');
	});
});

test('resolveAuthSecret fails closed in production when the secret is missing', () => {
	withEnv({ GLAZE_AUTH_SECRET: undefined, NODE_ENV: 'production' }, () => {
		expect(() => resolveAuthSecret(silent)).toThrow();
	});
});

test('resolveAuthSecret uses a dev fallback outside production (never empty)', () => {
	withEnv({ GLAZE_AUTH_SECRET: undefined, NODE_ENV: 'development' }, () => {
		const secret = resolveAuthSecret(silent);
		expect(secret.length > 0).toBe(true);
		expect(secret).toContain('development');
	});
});
