/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { createLogger, type Logger } from '@glaze/logger';
import { runSoloWorkflow } from './solo';
import * as detectorModule from '../../engine/detector';
import * as executorModule from '../../engine/executor';
import * as promptsModule from '@clack/prompts';

describe('runSoloWorkflow', () => {
	let logger: Logger;
	let mockDb: any;
	let detectSpy: any;
	let executeSpy: any;
	let exitSpy: any;

	beforeEach(() => {
		logger = createLogger({ name: 'test' });
		mockDb = {
			execute: () => Promise.resolve({ rows: [] }),
			transaction: () => Promise.resolve(),
		};
	});

	afterEach(() => {
		if (detectSpy) detectSpy.mockRestore();
		if (executeSpy) executeSpy.mockRestore();
		if (exitSpy) exitSpy.mockRestore();
	});

	it('should surface warnings and exit when hasDrift=false but warnings exist (ambiguous rename)', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: false,
			statements: [],
			summary: [],
			currentSnapshot: {},
			warnings: [
				'Ambiguous schema change (rename vs drop/create) detected. Manual intervention required.',
			],
		});

		exitSpy = spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});

		const warnSpy = spyOn(logger, 'warn');
		const errorSpy = spyOn(logger, 'error');

		try {
			await runSoloWorkflow({
				db: mockDb,
				logger,
				config: { destructive: 'fail', validation: 'permissive' },
				connectionString: 'postgresql://localhost/test',
				configPath: '/tmp/merged-config.ts',
			});
		} catch (error) {
			expect((error as Error).message).toBe('process.exit called');
		}

		expect(warnSpy).toHaveBeenCalledWith(
			'Ambiguous schema change (rename vs drop/create) detected. Manual intervention required.',
		);
		expect(errorSpy).toHaveBeenCalledWith(
			'Schema sync requires manual intervention. Server startup blocked.',
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('should log success when no drift detected', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: false,
			statements: [],
			summary: [],
			currentSnapshot: {},
		});

		const infoSpy = spyOn(logger, 'info');

		await runSoloWorkflow({
			db: mockDb,
			logger,
			config: { destructive: 'ask', validation: 'permissive' },
			connectionString: 'postgresql://localhost/test',
			configPath: '/tmp/merged-config.ts',
		});

		expect(infoSpy).toHaveBeenCalledWith('✓ Schema is in sync with database');
	});

	it('should auto-apply non-destructive changes when destructive=fail', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: true,
			statements: ['CREATE TABLE test'],
			summary: ['• Create table test'],
			currentSnapshot: {},
		});

		executeSpy = spyOn(executorModule, 'applyStatements').mockResolvedValue({
			success: true,
			appliedCount: 1,
		});

		await runSoloWorkflow({
			db: mockDb,
			logger,
			config: { destructive: 'fail', validation: 'permissive' },
			connectionString: 'postgresql://localhost/test',
			configPath: '/tmp/merged-config.ts',
		});

		expect(executeSpy).toHaveBeenCalled();
	});

	it('should exit with code 1 when destructive changes detected and destructive=fail', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: true,
			statements: ['DROP TABLE test'],
			summary: ['• Drop table test'],
			currentSnapshot: {},
			warnings: ['Dropping table "test" will cause data loss'],
		});

		exitSpy = spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});

		try {
			await runSoloWorkflow({
				db: mockDb,
				logger,
				config: { destructive: 'fail', validation: 'permissive' },
				connectionString: 'postgresql://localhost/test',
				configPath: '/tmp/merged-config.ts',
			});
		} catch (error) {
			expect((error as Error).message).toBe('process.exit called');
		}

		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('should exit with code 1 when destructive changes detected and validation=strict', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: true,
			statements: ['ALTER TABLE test DROP COLUMN name'],
			summary: ['• Drop column name'],
			currentSnapshot: {},
			warnings: ['Dropping column "name" will cause data loss'],
		});

		exitSpy = spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});

		// Verify that prompt is NOT called
		const confirmSpy = spyOn(promptsModule, 'confirm').mockResolvedValue(true);

		try {
			await runSoloWorkflow({
				db: mockDb,
				logger,
				config: { destructive: 'ask', validation: 'strict' },
				connectionString: 'postgresql://localhost/test',
				configPath: '/tmp/merged-config.ts',
			});
		} catch (error) {
			expect((error as Error).message).toBe('process.exit called');
		}

		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(confirmSpy).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it('should cancel without prompting when destructive=ask in non-TTY environment', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: true,
			statements: ['DROP TABLE test'],
			summary: ['• Drop table test'],
			currentSnapshot: {},
			warnings: ['Dropping table "test" will cause data loss'],
		});

		const confirmSpy = spyOn(promptsModule, 'confirm').mockResolvedValue(true);
		executeSpy = spyOn(executorModule, 'applyStatements').mockResolvedValue({
			success: true,
			appliedCount: 1,
		});

		const originalIsTTY = process.stdout.isTTY;
		Object.defineProperty(process.stdout, 'isTTY', {
			value: false,
			configurable: true,
		});

		try {
			await runSoloWorkflow({
				db: mockDb,
				logger,
				config: { destructive: 'ask', validation: 'permissive' },
				connectionString: 'postgresql://localhost/test',
				configPath: '/tmp/merged-config.ts',
			});
		} finally {
			Object.defineProperty(process.stdout, 'isTTY', {
				value: originalIsTTY,
				configurable: true,
			});
		}

		expect(confirmSpy).not.toHaveBeenCalled();
		expect(executeSpy).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it('should apply changes when user confirms and destructive=ask', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: true,
			statements: ['DROP TABLE test'],
			summary: ['• Drop table test'],
			currentSnapshot: {},
			warnings: ['Dropping table "test" will cause data loss'],
		});

		const confirmSpy = spyOn(promptsModule, 'confirm').mockResolvedValue(true);

		executeSpy = spyOn(executorModule, 'applyStatements').mockResolvedValue({
			success: true,
			appliedCount: 1,
		});

		Object.defineProperty(process.stdout, 'isTTY', {
			value: true,
			configurable: true,
		});
		try {
			await runSoloWorkflow({
				db: mockDb,
				logger,
				config: { destructive: 'ask', validation: 'permissive' },
				connectionString: 'postgresql://localhost/test',
				configPath: '/tmp/merged-config.ts',
			});
		} finally {
			Object.defineProperty(process.stdout, 'isTTY', {
				value: undefined,
				configurable: true,
			});
		}

		expect(confirmSpy).toHaveBeenCalled();
		expect(executeSpy).toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it('should not apply changes when user cancels and destructive=ask', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: true,
			statements: ['DROP TABLE test'],
			summary: ['• Drop table test'],
			currentSnapshot: {},
			warnings: ['Dropping table "test" will cause data loss'],
		});

		const confirmSpy = spyOn(promptsModule, 'confirm').mockResolvedValue(false);

		executeSpy = spyOn(executorModule, 'applyStatements').mockResolvedValue({
			success: true,
			appliedCount: 1,
		});

		Object.defineProperty(process.stdout, 'isTTY', {
			value: true,
			configurable: true,
		});
		try {
			await runSoloWorkflow({
				db: mockDb,
				logger,
				config: { destructive: 'ask', validation: 'permissive' },
				connectionString: 'postgresql://localhost/test',
				configPath: '/tmp/merged-config.ts',
			});
		} finally {
			Object.defineProperty(process.stdout, 'isTTY', {
				value: undefined,
				configurable: true,
			});
		}

		expect(confirmSpy).toHaveBeenCalled();
		expect(executeSpy).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it('should exit with code 1 when apply fails', async () => {
		detectSpy = spyOn(
			detectorModule,
			'detectDriftFromSchema',
		).mockResolvedValue({
			hasDrift: true,
			statements: ['CREATE TABLE test'],
			summary: ['• Create table test'],
			currentSnapshot: {},
		});

		executeSpy = spyOn(executorModule, 'applyStatements').mockResolvedValue({
			success: false,
			appliedCount: 0,
		});

		exitSpy = spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});

		try {
			await runSoloWorkflow({
				db: mockDb,
				logger,
				config: { destructive: 'fail', validation: 'permissive' },
				connectionString: 'postgresql://localhost/test',
				configPath: '/tmp/merged-config.ts',
			});
		} catch (error) {
			expect((error as Error).message).toBe('process.exit called');
		}

		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
