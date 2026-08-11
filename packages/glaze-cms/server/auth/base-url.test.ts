import { expect, test } from '#harness';

import { resolveAuthBaseUrl } from './base-url.ts';

/** Runs `fn` with `env` applied to `process.env`, restoring the prior values afterward. */
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
	const saved: Record<string, string | undefined> = {};
	for (const key of Object.keys(env)) {
		saved[key] = process.env[key];
		const value = env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return fn();
	} finally {
		for (const key of Object.keys(saved)) {
			const value = saved[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test('resolveAuthBaseUrl returns the configured GLAZE_AUTH_URL when set (any environment)', () => {
	withEnv({ GLAZE_AUTH_URL: 'https://cms.example.com', NODE_ENV: 'production' }, () => {
		expect(resolveAuthBaseUrl(3456)).toBe('https://cms.example.com');
	});
});

test('resolveAuthBaseUrl defaults to the local server origin outside production', () => {
	withEnv({ GLAZE_AUTH_URL: undefined, NODE_ENV: 'development' }, () => {
		expect(resolveAuthBaseUrl(3456)).toBe('http://localhost:3456');
	});
});

test('resolveAuthBaseUrl stays unset in production when GLAZE_AUTH_URL is missing', () => {
	withEnv({ GLAZE_AUTH_URL: undefined, NODE_ENV: 'production' }, () => {
		expect(resolveAuthBaseUrl(3456)).toBe(undefined);
	});
});
