import { describe, expect, it, mock } from 'bun:test';
import { introspectToSchema } from './introspect-db';

describe('introspect-db', () => {
	it('should throw if drizzle-kit fails', () => {
		const mockFailShell = mock(() => ({
			env: () => ({
				quiet: () =>
					Promise.resolve({ exitCode: 1, stderr: 'Connection refused' }),
			}),
		}));

		expect(
			introspectToSchema('url', { shell: mockFailShell as never }),
		).rejects.toThrow('drizzle-kit pull failed: Connection refused');
	});
});
