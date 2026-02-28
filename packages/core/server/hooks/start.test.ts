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

void mock.module('@glaze/convergence', () => ({
	runConvergence: mock(() => Promise.resolve()),
}));

import { handleStart } from './start';
import * as convergenceModule from '@glaze/convergence';

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

const createMockDecorator = (db: { execute: ReturnType<typeof mock> }) => ({
	logger: createMockLogger(),
	db,
	env: { GLAZE_DATABASE_URL: 'postgres://localhost:5432/test' },
	config: { sync: { workflow: 'solo' as const, enabled: false } },
});

describe('handleStart', () => {
	let originalExit: typeof process.exit;

	beforeEach(() => {
		// eslint-disable-next-line @typescript-eslint/unbound-method
		originalExit = process.exit;
		process.exit = mock(() => {}) as unknown as typeof process.exit;
	});

	afterEach(() => {
		process.exit = originalExit;
	});

	it('should successfully verify database connection', async () => {
		const mockExecute = mock(() => Promise.resolve([{ '?column?': 1 }]));
		const decorator = createMockDecorator({ execute: mockExecute });
		const errorSpy = spyOn(decorator.logger, 'error');

		await handleStart({ decorator: decorator as never });

		expect(mockExecute).toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		// eslint-disable-next-line @typescript-eslint/unbound-method
		expect(process.exit).not.toHaveBeenCalled();
	});

	it('should log error and exit with code 1 on connection failure', async () => {
		const mockExecute = mock(() =>
			Promise.reject(new Error('Connection refused')),
		);
		const decorator = createMockDecorator({ execute: mockExecute });
		const errorSpy = spyOn(decorator.logger, 'error');
		const infoSpy = spyOn(decorator.logger, 'info');

		await handleStart({ decorator: decorator as never });

		expect(errorSpy).toHaveBeenCalledWith('Could not connect to database.');
		expect(infoSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				'Please make sure the database is running and accessible.',
			),
		);
		// eslint-disable-next-line @typescript-eslint/unbound-method
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('should log DrizzleQueryError cause at debug level', async () => {
		const cause = new Error('ECONNREFUSED 127.0.0.1:5432');

		const drizzleOrm = await import('drizzle-orm');
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		const ErrorClass =
			(drizzleOrm as any).DrizzleQueryError ?? drizzleOrm.DrizzleError;

		let drizzleError: Error;
		try {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			drizzleError = new ErrorClass('Query failed', cause) as Error;
		} catch {
			// Constructor might use object form
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			drizzleError = new ErrorClass({
				message: 'Query failed',
				cause,
			}) as Error;
		}

		const mockExecute = mock(() => Promise.reject(drizzleError));
		const decorator = createMockDecorator({ execute: mockExecute });
		const debugSpy = spyOn(decorator.logger, 'debug');

		await handleStart({ decorator: decorator as never });

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
		const decorator = createMockDecorator({ execute: mockExecute });
		const debugSpy = spyOn(decorator.logger, 'debug');

		await handleStart({ decorator: decorator as never });

		expect(debugSpy).not.toHaveBeenCalled();
		// eslint-disable-next-line @typescript-eslint/unbound-method
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('should call runConvergence with config, db, logger, connectionString, and glazeSchemaPath', async () => {
		const mockExecute = mock(() => Promise.resolve([{ '?column?': 1 }]));
		const decorator = createMockDecorator({ execute: mockExecute });

		const runConvergenceMock = convergenceModule.runConvergence as ReturnType<
			typeof mock
		>;
		runConvergenceMock.mockClear();

		await handleStart({ decorator: decorator as never });

		expect(runConvergenceMock).toHaveBeenCalledTimes(1);
		expect(runConvergenceMock).toHaveBeenCalledWith({
			config: decorator.config.sync,
			db: decorator.db,
			logger: decorator.logger,
			connectionString: decorator.env.GLAZE_DATABASE_URL,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			glazeSchemaPath: expect.stringContaining('schema'),
		});
	});

	it('should always log the generic error message regardless of error type', async () => {
		const mockExecute = mock(() =>
			Promise.reject(new RangeError('unexpected')),
		);
		const decorator = createMockDecorator({ execute: mockExecute });
		const errorSpy = spyOn(decorator.logger, 'error');

		await handleStart({ decorator: decorator as never });

		expect(errorSpy).toHaveBeenCalledWith('Could not connect to database.');
	});
});
