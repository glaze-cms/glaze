import { describe, it, expect } from 'bun:test';
import { authResolver } from './auth';
import type { AuthConfig } from '../../types/auth';

describe('authResolver', () => {
	describe('basePath', () => {
		it('should create correct basePath from apiPrefix', () => {
			const result = authResolver('/api', undefined);

			expect(result.basePath).toBe('/api/auth');
		});

		it('should strip trailing slash from apiPrefix', () => {
			const result = authResolver('/api/', undefined);

			expect(result.basePath).toBe('/api/auth');
		});
	});

	describe('publicAuthEnabled', () => {
		it('should be true by default', () => {
			const result = authResolver('/api', undefined);

			expect(result.publicAuthEnabled).toBe(true);
		});

		it('should be false when auth is disabled', () => {
			const result = authResolver('/api', { enabled: false });

			expect(result.publicAuthEnabled).toBe(false);
		});

		it('should be true when auth is explicitly enabled', () => {
			const result = authResolver('/api', { enabled: true });

			expect(result.publicAuthEnabled).toBe(true);
		});
	});

	describe('appName', () => {
		it('should default to "Glaze CMS"', () => {
			const result = authResolver('/api', undefined);

			expect(result.appName).toBe('Glaze CMS');
		});
	});

	describe('emailAndPassword', () => {
		it('should be enabled by default', () => {
			const result = authResolver('/api', undefined);

			expect(result.emailAndPassword?.enabled).toBe(true);
		});

		it('should merge user config from top-level emailAndPassword', () => {
			const authConfig: AuthConfig = {
				enabled: true,
				emailAndPassword: { requireEmailVerification: true },
			};
			const result = authResolver('/api', authConfig);

			expect(result.emailAndPassword).toMatchObject({
				enabled: true,
				requireEmailVerification: true,
			});
		});

		it('should merge user config from betterAuth.emailAndPassword', () => {
			const authConfig: AuthConfig = {
				enabled: true,
				betterAuth: { emailAndPassword: { requireEmailVerification: true } },
			};
			const result = authResolver('/api', authConfig);

			expect(result.emailAndPassword).toMatchObject({
				enabled: true,
				requireEmailVerification: true,
			});
		});

		it('should prefer betterAuth.emailAndPassword over top-level', () => {
			const authConfig: AuthConfig = {
				enabled: true,
				emailAndPassword: { requireEmailVerification: false },
				betterAuth: { emailAndPassword: { requireEmailVerification: true } },
			};
			const result = authResolver('/api', authConfig);

			expect(result.emailAndPassword?.requireEmailVerification).toBe(true);
		});

		it('should always force enabled: true even when auth is disabled', () => {
			const result = authResolver('/api', { enabled: false });

			expect(result.emailAndPassword).toEqual({ enabled: true });
		});
	});

	describe('emailVerification', () => {
		it('should be undefined by default', () => {
			const result = authResolver('/api', undefined);

			expect(result.emailVerification).toBeUndefined();
		});

		it('should pass through top-level emailVerification', () => {
			const authConfig: AuthConfig = {
				enabled: true,
				emailVerification: { sendOnSignUp: true },
			};
			const result = authResolver('/api', authConfig);

			expect(result.emailVerification).toEqual({ sendOnSignUp: true });
		});

		it('should pass through betterAuth.emailVerification', () => {
			const authConfig: AuthConfig = {
				enabled: true,
				betterAuth: { emailVerification: { sendOnSignUp: true } },
			};
			const result = authResolver('/api', authConfig);

			expect(result.emailVerification).toEqual({ sendOnSignUp: true });
		});

		it('should be undefined when auth is disabled', () => {
			const result = authResolver('/api', { enabled: false });

			expect(result.emailVerification).toBeUndefined();
		});
	});

	describe('plugins', () => {
		it('should be undefined by default', () => {
			const result = authResolver('/api', undefined);

			expect(result.plugins).toBeUndefined();
		});

		it('should be undefined when auth is disabled', () => {
			const result = authResolver('/api', { enabled: false });

			expect(result.plugins).toBeUndefined();
		});

		it('should pass through top-level plugins', () => {
			const plugin = { id: 'my-plugin' };
			const authConfig: AuthConfig = {
				enabled: true,
				plugins: [plugin],
			};
			const result = authResolver('/api', authConfig);

			expect(result.plugins).toEqual([plugin]);
		});

		it('should pass through betterAuth.plugins', () => {
			const plugin = { id: 'my-plugin' };
			const authConfig: AuthConfig = {
				enabled: true,
				betterAuth: { plugins: [plugin] },
			};
			const result = authResolver('/api', authConfig);

			expect(result.plugins).toEqual([plugin]);
		});

		it('should prefer betterAuth.plugins over top-level plugins', () => {
			const topLevel = { id: 'top-level' };
			const nested = { id: 'nested' };
			const authConfig: AuthConfig = {
				enabled: true,
				plugins: [topLevel],
				betterAuth: { plugins: [nested] },
			};
			const result = authResolver('/api', authConfig);

			expect(result.plugins).toEqual([nested]);
		});
	});

	describe('drizzleAdapter', () => {
		it('should be undefined by default', () => {
			const result = authResolver('/api', undefined);

			expect(result.drizzleAdapter).toBeUndefined();
		});

		it('should pass through drizzleAdapter config', () => {
			const authConfig: AuthConfig = {
				enabled: true,
				drizzleAdapter: { debugLogs: true },
			};
			const result = authResolver('/api', authConfig);

			expect(result.drizzleAdapter).toEqual({ debugLogs: true });
		});

		it('should be undefined when auth is disabled', () => {
			const result = authResolver('/api', { enabled: false });

			expect(result.drizzleAdapter).toBeUndefined();
		});
	});
});
