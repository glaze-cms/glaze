import { afterEach, describe, expect, it, mock } from 'bun:test';
import { runIntrospectionInBackground } from './introspect';
import type { Logger } from '@glaze/logger';

const mockSyncSchema = mock(() => Promise.resolve(['/out/a.ts', '/out/b.ts']));

const createMockLogger = () =>
	({
		warn: mock(() => {}),
		debug: mock(() => {}),
	}) as unknown as Logger;

describe('runIntrospectionInBackground', () => {
	afterEach(() => {
		mockSyncSchema.mockClear();
	});

	it('calls syncSchema with the correct connectionString and schemaOutDir', async () => {
		const logger = createMockLogger();
		mockSyncSchema.mockImplementation(() => Promise.resolve(['/out/a.ts']));

		runIntrospectionInBackground({
			connectionString: 'postgres://localhost:5432/mydb',
			schemaOutDir: '/out',
			logger,
			syncSchema: mockSyncSchema,
		});

		await Promise.resolve();

		expect(mockSyncSchema).toHaveBeenCalledWith(
			'postgres://localhost:5432/mydb',
			'/out',
		);
	});

	it('calls logger.debug with a message containing the file count on success', async () => {
		const logger = createMockLogger();
		mockSyncSchema.mockImplementation(() =>
			Promise.resolve(['/out/a.ts', '/out/b.ts']),
		);

		runIntrospectionInBackground({
			connectionString: 'postgres://localhost:5432/mydb',
			schemaOutDir: '/out',
			logger,
			syncSchema: mockSyncSchema,
		});

		await Promise.resolve();

		expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('2'));
	});

	it('calls logger.warn with a message containing the error message on failure', async () => {
		const logger = createMockLogger();
		mockSyncSchema.mockImplementation(() =>
			Promise.reject(new Error('DB down')),
		);

		runIntrospectionInBackground({
			connectionString: 'postgres://localhost:5432/mydb',
			schemaOutDir: '/out',
			logger,
			syncSchema: mockSyncSchema,
		});

		await Promise.resolve();

		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('DB down'),
		);
	});
});
