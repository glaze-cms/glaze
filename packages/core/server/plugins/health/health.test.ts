import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { healthCheckPlugin } from './health';
import { DEFAULT_HEALTH_CHECK_PATH } from '../../lib/consts/defaults';

describe('healthCheckPlugin', () => {
	describe('path normalization', () => {
		it('should use default path when no config provided', () => {
			const app = new Elysia();
			const routesBefore = app.routes.length;

			app.use(healthCheckPlugin());

			expect(app.routes.length).toBeGreaterThan(routesBefore);
		});

		it('should use custom path when provided', () => {
			const app = new Elysia();

			app.use(healthCheckPlugin({ path: '/custom' }));

			const hasCustomRoute = app.routes.some(
				(route) => route.path === '/custom',
			);
			expect(hasCustomRoute).toBe(true);
		});

		it('should normalize path without leading slash', () => {
			const app = new Elysia();

			app.use(healthCheckPlugin({ path: 'healthz' }));

			const hasNormalizedRoute = app.routes.some(
				(route) => route.path === '/healthz',
			);
			expect(hasNormalizedRoute).toBe(true);
		});

		it('should fallback to default for empty string path', () => {
			const app = new Elysia();

			app.use(healthCheckPlugin({ path: '' }));

			const hasDefaultRoute = app.routes.some(
				(route) => route.path === DEFAULT_HEALTH_CHECK_PATH,
			);
			expect(hasDefaultRoute).toBe(true);
		});

		it('should fallback to default for whitespace-only path', () => {
			const app = new Elysia();

			app.use(healthCheckPlugin({ path: '   ' }));

			const hasDefaultRoute = app.routes.some(
				(route) => route.path === DEFAULT_HEALTH_CHECK_PATH,
			);
			expect(hasDefaultRoute).toBe(true);
		});

		it('should fallback to default for undefined path', () => {
			const app = new Elysia();

			app.use(healthCheckPlugin({ path: undefined }));

			const hasDefaultRoute = app.routes.some(
				(route) => route.path === DEFAULT_HEALTH_CHECK_PATH,
			);
			expect(hasDefaultRoute).toBe(true);
		});
	});

	describe('enabled/disabled behavior', () => {
		it('should register routes when enabled is true', () => {
			const app = new Elysia();
			const routesBefore = app.routes.length;

			app.use(healthCheckPlugin({ enabled: true }));

			expect(app.routes.length).toBeGreaterThan(routesBefore);
		});

		it('should not register routes when disabled', () => {
			const app = new Elysia();
			const routesBefore = app.routes.length;

			app.use(healthCheckPlugin({ enabled: false }));

			expect(app.routes.length).toBe(routesBefore);
		});

		it('should default to enabled when enabled is not specified', () => {
			const app = new Elysia();
			const routesBefore = app.routes.length;

			app.use(healthCheckPlugin({}));

			expect(app.routes.length).toBeGreaterThan(routesBefore);
		});
	});

	describe('response handler', () => {
		it('should return health response with correct structure', () => {
			const app = new Elysia().use(healthCheckPlugin());

			const healthRoute = app.routes.find(
				(route) => route.path === DEFAULT_HEALTH_CHECK_PATH,
			);
			expect(healthRoute).toBeDefined();

			if (healthRoute?.handler && typeof healthRoute.handler === 'function') {
				const response = healthRoute.handler(
					{} as Parameters<typeof healthRoute.handler>[0],
				) as {
					status: string;
					timestamp: string;
					uptime: number;
				};

				expect(response.status).toBe('ok');
				expect(typeof response.timestamp).toBe('string');
				expect(typeof response.uptime).toBe('number');
			}
		});
	});
});
