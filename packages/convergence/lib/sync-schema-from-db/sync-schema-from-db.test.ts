import { afterEach, describe, expect, it, mock } from 'bun:test';
import { syncSchemaFromDB } from './sync-schema-from-db';

const mockIntrospect = mock(() => Promise.resolve('export const mock = {};'));
const mockSplit = mock(() => Promise.resolve({ files: ['/out/schema.ts'] }));

describe('sync-schema-from-db', () => {
	afterEach(() => {
		mockIntrospect.mockClear();
		mockSplit.mockClear();
	});

	it('should coordinate introspection and splitting', async () => {
		const files = await syncSchemaFromDB('postgres://db', '/out', {
			introspector: mockIntrospect,
			splitter: mockSplit,
		});

		expect(files).toEqual(['/out/schema.ts']);

		expect(mockIntrospect).toHaveBeenCalledWith('postgres://db');

		expect(mockSplit).toHaveBeenCalled();
		const call = (mockSplit.mock.calls as unknown as unknown[][])[0];
		if (!call) throw new Error('Call not found');
		const splitArgs = call[0] as { content: string; outDir: string };

		expect(splitArgs.content).toBe('export const mock = {};');
		expect(splitArgs.outDir).toBe('/out');
	});
});
