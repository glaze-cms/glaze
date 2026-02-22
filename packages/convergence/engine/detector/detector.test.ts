/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
	describe,
	it,
	expect,
	spyOn,
	afterEach,
	beforeAll,
	afterAll,
	mock,
} from 'bun:test';
import { detectDriftFromSchema } from './detector';
import {
	validateDrizzleConfigPath,
	looksLikeInteractiveRenamePrompt,
} from '../../lib/drizzle-kit/utils';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
let configPath: string;

const mockSpawn = spyOn(Bun, 'spawn');

const mockDb = {
	execute: mock(() => Promise.resolve({ rows: [] } as any)),
	transaction: mock(() => Promise.resolve()),
};

beforeAll(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'glaze-detector-test-'));
	configPath = join(tempDir, 'drizzle.config.ts');
	writeFileSync(
		configPath,
		"export default { dialect: 'postgresql', dbCredentials: { url: process.env.DATABASE_URL } };\n",
	);
});

afterAll(() => {
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe('detectDriftFromSchema - Interactive Fallback', () => {
	afterEach(() => {
		mockSpawn.mockClear();
	});

	const connectionString = 'postgres://localhost:5432/test';

	// Helper to create a mock process
	const createMockProc = (output: string, exitCode = 0) =>
		({
			stdout: new Blob([output]),
			stderr: new Blob(['']),
			exited: Promise.resolve(),
			exitCode,
			kill: () => {},
			unref: () => {},
			ref: () => {},
			pid: 123,
		}) as any;

	it('should trigger interactive fallback when ambiguous output is detected in permissive mode', async () => {
		// First call simulates explain output with ambiguity
		const explainOutput =
			'Is posts.status column created or renamed from another column?';
		const mockProc1 = createMockProc(explainOutput);

		// Second call simulates successful interactive push
		const mockProc2 = createMockProc('Applied changes');

		mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);

		const result = await detectDriftFromSchema({
			connectionString,
			configPath,
			db: mockDb,
			interactive: true,
			sync: { validation: 'permissive', destructive: 'ask' },
		});

		expect(mockSpawn).toHaveBeenCalledTimes(2);
		// Check second call arguments for interactive flags
		const secondCallArg = mockSpawn.mock.calls[1]?.[1] as any;
		expect(secondCallArg?.env?.CI).toBe('false');
		expect(secondCallArg?.stdin).toBe('inherit');

		// Should return no drift since it was handled interactively
		expect(result.hasDrift).toBe(false);
	});

	it('should BLOCK interactive fallback when validation is STRICT', async () => {
		const explainOutput =
			'Is posts.status column created or renamed from another column?';
		mockSpawn.mockReturnValue(createMockProc(explainOutput));

		const result = await detectDriftFromSchema({
			connectionString,
			configPath,
			db: mockDb,
			interactive: true,
			sync: { validation: 'strict', destructive: 'ask' },
		});

		expect(mockSpawn).toHaveBeenCalledTimes(1);
		expect(result.warnings).toContain(
			'Ambiguous schema change (rename vs drop/create) detected. Manual intervention required.',
		);
	});

	it('should BLOCK interactive fallback when destructive is FAIL', async () => {
		const explainOutput =
			'Is posts.status column created or renamed from another column?';
		mockSpawn.mockReturnValue(createMockProc(explainOutput));

		const result = await detectDriftFromSchema({
			connectionString,
			configPath,
			db: mockDb,
			interactive: true,
			sync: { validation: 'permissive', destructive: 'fail' },
		});

		expect(mockSpawn).toHaveBeenCalledTimes(1);
		expect(result.warnings).toContain(
			'Ambiguous schema change (rename vs drop/create) detected. Manual intervention required.',
		);
	});

	it('should not fallback if interactive is false', async () => {
		const explainOutput =
			'Is posts.status column created or renamed from another column?';
		mockSpawn.mockReturnValue(createMockProc(explainOutput));

		const result = await detectDriftFromSchema({
			connectionString,
			configPath,
			db: mockDb,
			interactive: false,
			sync: { validation: 'permissive', destructive: 'ask' },
		});

		expect(mockSpawn).toHaveBeenCalledTimes(1);
		expect(result.warnings).toContain(
			'Ambiguous schema change (rename vs drop/create) detected. Manual intervention required.',
		);
	});

	it('should not trigger fallback on generic error text (no rename prompt)', async () => {
		const explainOutput =
			'Error: interactive mode is not supported in CI for this command';
		mockSpawn.mockReturnValue(createMockProc(explainOutput));

		const result = await detectDriftFromSchema({
			connectionString,
			configPath,
			db: mockDb,
			interactive: true,
			sync: { validation: 'permissive', destructive: 'ask' },
		});

		expect(mockSpawn).toHaveBeenCalledTimes(1);
		// Should not attempt interactive push, but should still return a DriftResult.
		expect(result.hasDrift).toBe(false);
	});
});

describe('validateDrizzleConfigPath', () => {
	it('should accept an existing .ts config path', () => {
		// Ensure temp file exists for this assertion
		if (!tempDir) {
			tempDir = mkdtempSync(join(tmpdir(), 'glaze-detector-test-'));
			configPath = join(tempDir, 'drizzle.config.ts');
			writeFileSync(configPath, 'export default {};\n');
		}
		expect(validateDrizzleConfigPath(configPath)).toBe(configPath);
	});

	it('should throw on invalid characters (null bytes)', () => {
		expect(() => validateDrizzleConfigPath('config\0.ts')).toThrow(
			'Invalid drizzle config path',
		);
	});

	it('should throw on empty path', () => {
		expect(() => validateDrizzleConfigPath('  ')).toThrow(
			'Invalid drizzle config path',
		);
	});

	it('should throw on invalid extension', () => {
		expect(() => validateDrizzleConfigPath('config.txt')).toThrow(
			'Invalid drizzle config path extension',
		);
	});

	it('should throw when file does not exist', () => {
		const missing = join(tmpdir(), 'glaze-detector-test-missing.ts');
		expect(() => validateDrizzleConfigPath(missing)).toThrow(
			'Drizzle config file not found',
		);
	});
});

describe('looksLikeInteractiveRenamePrompt', () => {
	it('returns true for created or renamed column prompt', () => {
		expect(
			looksLikeInteractiveRenamePrompt(
				'Is posts.status column created or renamed from another column?',
			),
		).toBe(true);
	});

	it('returns true for created or renamed table prompt', () => {
		expect(
			looksLikeInteractiveRenamePrompt(
				'Is users table created or renamed from another table?',
			),
		).toBe(true);
	});

	it('returns false when text appears but not as a question', () => {
		expect(
			looksLikeInteractiveRenamePrompt(
				'column created or renamed from another',
			),
		).toBe(false);
	});

	it('returns false for unrelated questions (avoid false positives)', () => {
		expect(
			looksLikeInteractiveRenamePrompt('Do you want to continue?'),
		).toBe(false);
	});
});
