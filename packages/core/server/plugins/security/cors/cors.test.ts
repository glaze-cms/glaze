import { describe, expect, it, spyOn, beforeEach, afterEach } from 'bun:test';
import type { Logger } from '@glaze/logger';
import { corsPlugin } from './cors';

describe('corsPlugin', () => {
	let originalNodeEnv: string | undefined;

	beforeEach(() => {
		originalNodeEnv = process.env.NODE_ENV;
	});

	afterEach(() => {
		if (originalNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = originalNodeEnv;
		}
	});

	describe('production warning', () => {
		it('should warn when no origins configured in production', () => {
			process.env.NODE_ENV = 'production';

			const mockLogger: Logger = {
				warn: () => {},
				info: () => {},
				error: () => {},
				debug: () => {},
				trace: () => {},
				fatal: () => {},
				silent: () => {},
				level: 'info',
				msgPrefix: '',
				child: () => mockLogger,
			} as unknown as Logger;
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin(undefined, mockLogger);

			expect(warnSpy).toHaveBeenCalledWith(
				'[@glaze/cors] No CORS origins configured in production. All cross-origin requests will be blocked.',
			);
		});

		it('should not warn when origins are configured in production', () => {
			process.env.NODE_ENV = 'production';

			const mockLogger: Logger = {
				warn: () => {},
				info: () => {},
				error: () => {},
				debug: () => {},
				trace: () => {},
				fatal: () => {},
				silent: () => {},
				level: 'info',
				msgPrefix: '',
				child: () => mockLogger,
			} as unknown as Logger;
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin({ cors: { origin: ['https://myapp.com'] } }, mockLogger);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not warn in development mode', () => {
			process.env.NODE_ENV = 'development';

			const mockLogger: Logger = {
				warn: () => {},
				info: () => {},
				error: () => {},
				debug: () => {},
				trace: () => {},
				fatal: () => {},
				silent: () => {},
				level: 'info',
				msgPrefix: '',
				child: () => mockLogger,
			} as unknown as Logger;
			const warnSpy = spyOn(mockLogger, 'warn');

			corsPlugin(undefined, mockLogger);

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('should not throw when logger is not provided', () => {
			process.env.NODE_ENV = 'production';

			expect(() => corsPlugin()).not.toThrow();
		});
	});

	describe('environment-based defaults', () => {
		it('should create plugin in development mode', () => {
			process.env.NODE_ENV = 'development';

			const plugin = corsPlugin();

			expect(plugin).toBeDefined();
		});

		it('should create plugin in production mode', () => {
			process.env.NODE_ENV = 'production';

			const plugin = corsPlugin();

			expect(plugin).toBeDefined();
		});
	});

	describe('configuration handling', () => {
		it('should accept custom origin configuration', () => {
			process.env.NODE_ENV = 'production';

			const plugin = corsPlugin({
				cors: { origin: ['https://myapp.com'] },
			});

			expect(plugin).toBeDefined();
		});

		it('should accept custom methods configuration', () => {
			process.env.NODE_ENV = 'production';

			const plugin = corsPlugin({
				cors: { methods: ['GET', 'POST'] },
			});

			expect(plugin).toBeDefined();
		});

		it('should accept custom allowedHeaders configuration', () => {
			process.env.NODE_ENV = 'production';

			const plugin = corsPlugin({
				cors: { allowedHeaders: ['X-Custom-Header'] },
			});

			expect(plugin).toBeDefined();
		});

		it('should handle multiple CORS options together', () => {
			process.env.NODE_ENV = 'production';

			const plugin = corsPlugin({
				cors: {
					origin: ['https://myapp.com'],
					methods: ['GET', 'POST'],
					allowedHeaders: ['X-Custom-Header', 'Authorization'],
				},
			});

			expect(plugin).toBeDefined();
		});
	});
});
