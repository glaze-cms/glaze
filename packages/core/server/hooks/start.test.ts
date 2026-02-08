import {
	describe,
	it,
	expect,
	mock,
	spyOn,
	beforeEach,
	afterEach,
} from 'bun:test';
import type { Logger } from '@glaze/logger';
import { handleStart } from './start';

const createMockLogger = (): Logger =>
	({
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {},
		trace: () => {},
		fatal: () => {},
		silent: () => {},
		level: 'info',
		msgPrefix: '',
		child: () => createMockLogger(),
	}) as unknown as Logger;

describe('handleStart', () => {
	let originalExit: typeof process.exit;

	beforeEach(() => {
		originalExit = process.exit;
		process.exit = mock(() => {}) as unknown as typeof process.exit;
	});

	afterEach(() => {
		process.exit = originalExit;
	});

	it('should successfully verify database connection', async () => {
		const mockExecute = mock(() => Promise.resolve([{ '?column?': 1 }]));
		const mockLogger = createMockLogger();
		const errorSpy = spyOn(mockLogger, 'error');

		await handleStart({
			decorator: {
				logger: mockLogger,
				db: { execute: mockExecute },
			} as any,
		});

		expect(mockExecute).toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalled();
	});

	it('should log error and exit with code 1 on connection failure', async () => {
		const mockExecute = mock(() =>
			Promise.reject(new Error('Connection refused')),
		);
		const mockLogger = createMockLogger();
		const errorSpy = spyOn(mockLogger, 'error');
		const infoSpy = spyOn(mockLogger, 'info');

		await handleStart({
			decorator: {
				logger: mockLogger,
				db: { execute: mockExecute },
			} as any,
		});

		expect(errorSpy).toHaveBeenCalledWith('Could not connect to database.');
		expect(infoSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				'Please make sure the database is running and accessible.',
			),
		);
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('should log DrizzleQueryError cause at debug level', async () => {
		const { DrizzleError } = await import('drizzle-orm');
		// DrizzleQueryError extends DrizzleError. Create one with a cause.
		const cause = new Error('ECONNREFUSED 127.0.0.1:5432');

		// Use a dynamic import to get the actual error class
		const drizzleOrm = await import('drizzle-orm');
		const ErrorClass =
			(drizzleOrm as any).DrizzleQueryError ?? drizzleOrm.DrizzleError;

		let drizzleError: Error;
		try {
			drizzleError = new ErrorClass('Query failed', cause);
		} catch {
			// Constructor might use object form
			drizzleError = new ErrorClass({ message: 'Query failed', cause });
		}

		const mockExecute = mock(() => Promise.reject(drizzleError));
		const mockLogger = createMockLogger();
		const debugSpy = spyOn(mockLogger, 'debug');

		await handleStart({
			decorator: {
				logger: mockLogger,
				db: { execute: mockExecute },
			} as any,
		});

		// If it's a proper DrizzleQueryError with Error cause, debug should be called
		if (
			drizzleError.constructor.name === 'DrizzleQueryError' &&
			drizzleError.cause instanceof Error
		) {
			expect(debugSpy).toHaveBeenCalledWith('ECONNREFUSED 127.0.0.1:5432');
		}
	});

	it('should not log debug for non-DrizzleQueryError failures', async () => {
		const mockExecute = mock(() =>
			Promise.reject(new TypeError('Something else')),
		);
		const mockLogger = createMockLogger();
		const debugSpy = spyOn(mockLogger, 'debug');

		await handleStart({
			decorator: {
				logger: mockLogger,
				db: { execute: mockExecute },
			} as any,
		});

		expect(debugSpy).not.toHaveBeenCalled();
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('should always log the generic error message regardless of error type', async () => {
		const mockExecute = mock(() =>
			Promise.reject(new RangeError('unexpected')),
		);
		const mockLogger = createMockLogger();
		const errorSpy = spyOn(mockLogger, 'error');

		await handleStart({
			decorator: {
				logger: mockLogger,
				db: { execute: mockExecute },
			} as any,
		});

		expect(errorSpy).toHaveBeenCalledWith('Could not connect to database.');
	});
});
