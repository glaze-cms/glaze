import { describe, it, expect } from 'bun:test';
import { syncResolver } from './sync';

describe('syncResolver', () => {
	describe('enabled', () => {
		it('should be true by default', () => {
			const result = syncResolver('development');

			expect(result.enabled).toBe(true);
		});

		it('should respect user-provided enabled: false', () => {
			const result = syncResolver('development', {
				workflow: 'solo',
				enabled: false,
			});

			expect(result.enabled).toBe(false);
		});

		it('should respect user-provided enabled: true', () => {
			const result = syncResolver('production', {
				workflow: 'solo',
				enabled: true,
			});

			expect(result.enabled).toBe(true);
		});
	});

	describe('workflow', () => {
		it('should default to solo workflow', () => {
			const result = syncResolver('development');

			expect(result.workflow).toBe('solo');
		});

		it('should use team workflow when specified', () => {
			const result = syncResolver('development', { workflow: 'team' });

			expect(result.workflow).toBe('team');
		});
	});

	describe('solo workflow', () => {
		describe('destructive', () => {
			it('should default to "ask" in development', () => {
				const result = syncResolver('development');

				expect(result.workflow).toBe('solo');
				if (result.workflow === 'solo') {
					expect(result.solo?.destructive).toBe('ask');
				}
			});

			it('should default to "ask" in local', () => {
				const result = syncResolver('local');

				expect(result.workflow).toBe('solo');
				if (result.workflow === 'solo') {
					expect(result.solo?.destructive).toBe('ask');
				}
			});

			it('should default to "ask" in test', () => {
				const result = syncResolver('test');

				expect(result.workflow).toBe('solo');
				if (result.workflow === 'solo') {
					expect(result.solo?.destructive).toBe('ask');
				}
			});

			it('should default to "fail" in production', () => {
				const result = syncResolver('production');

				expect(result.workflow).toBe('solo');
				if (result.workflow === 'solo') {
					expect(result.solo?.destructive).toBe('fail');
				}
			});

			it('should default to "fail" in staging', () => {
				const result = syncResolver('staging');

				expect(result.workflow).toBe('solo');
				if (result.workflow === 'solo') {
					expect(result.solo?.destructive).toBe('fail');
				}
			});

			it('should respect user-provided destructive value', () => {
				const result = syncResolver('production', {
					workflow: 'solo',
					solo: { destructive: 'apply' },
				});

				if (result.workflow === 'solo') {
					expect(result.solo?.destructive).toBe('apply');
				}
			});
		});

		describe('validation', () => {
			it('should default to "permissive" in development', () => {
				const result = syncResolver('development');

				if (result.workflow === 'solo') {
					expect(result.solo?.validation).toBe('permissive');
				}
			});

			it('should default to "strict" in production', () => {
				const result = syncResolver('production');

				if (result.workflow === 'solo') {
					expect(result.solo?.validation).toBe('strict');
				}
			});

			it('should default to "strict" in staging', () => {
				const result = syncResolver('staging');

				if (result.workflow === 'solo') {
					expect(result.solo?.validation).toBe('strict');
				}
			});

			it('should respect user-provided validation value', () => {
				const result = syncResolver('production', {
					workflow: 'solo',
					solo: { validation: 'permissive' },
				});

				if (result.workflow === 'solo') {
					expect(result.solo?.validation).toBe('permissive');
				}
			});
		});

		describe('configPath', () => {
			it('should be undefined by default', () => {
				const result = syncResolver('development');

				if (result.workflow === 'solo') {
					expect(result.solo?.configPath).toBeUndefined();
				}
			});

			it('should pass through user-provided configPath', () => {
				const result = syncResolver('development', {
					workflow: 'solo',
					solo: { configPath: 'custom.config.ts' },
				});

				if (result.workflow === 'solo') {
					expect(result.solo?.configPath).toBe('custom.config.ts');
				}
			});
		});

		describe('schemaOutDir', () => {
			it('should be undefined by default', () => {
				const result = syncResolver('development');

				if (result.workflow === 'solo') {
					expect(result.solo?.schemaOutDir).toBeUndefined();
				}
			});

			it('should pass through user-provided schemaOutDir', () => {
				const result = syncResolver('development', {
					workflow: 'solo',
					solo: { schemaOutDir: './my-schema' },
				});

				if (result.workflow === 'solo') {
					expect(result.solo?.schemaOutDir).toBe('./my-schema');
				}
			});
		});
	});

	describe('team workflow', () => {
		describe('autoRun', () => {
			it('should default to true in development', () => {
				const result = syncResolver('development', { workflow: 'team' });

				if (result.workflow === 'team') {
					expect(result.team?.autoRun).toBe(true);
				}
			});

			it('should default to true in local', () => {
				const result = syncResolver('local', { workflow: 'team' });

				if (result.workflow === 'team') {
					expect(result.team?.autoRun).toBe(true);
				}
			});

			it('should default to false in production', () => {
				const result = syncResolver('production', { workflow: 'team' });

				if (result.workflow === 'team') {
					expect(result.team?.autoRun).toBe(false);
				}
			});

			it('should default to false in staging', () => {
				const result = syncResolver('staging', { workflow: 'team' });

				if (result.workflow === 'team') {
					expect(result.team?.autoRun).toBe(false);
				}
			});

			it('should respect user-provided autoRun', () => {
				const result = syncResolver('production', {
					workflow: 'team',
					team: { autoRun: true },
				});

				if (result.workflow === 'team') {
					expect(result.team?.autoRun).toBe(true);
				}
			});
		});

		describe('configPath', () => {
			it('should default to "drizzle.config.ts"', () => {
				const result = syncResolver('development', { workflow: 'team' });

				if (result.workflow === 'team') {
					expect(result.team?.configPath).toBe('drizzle.config.ts');
				}
			});

			it('should pass through user-provided configPath', () => {
				const result = syncResolver('development', {
					workflow: 'team',
					team: { configPath: 'custom.config.ts' },
				});

				if (result.workflow === 'team') {
					expect(result.team?.configPath).toBe('custom.config.ts');
				}
			});
		});
	});
});
