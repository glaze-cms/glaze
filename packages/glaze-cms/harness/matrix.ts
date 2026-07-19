import { test } from 'bun:test';

import { createLogger } from '../logger/index.ts';
import { isDockerAvailable, provisionDatabase } from './provisioner.ts';
import { DIALECTS } from './targets.ts';

import type { DatabaseHandle, Dialect } from '../dialect/index.ts';
import type { Logger } from '../logger/index.ts';

/** Resolved once at load: skip the Postgres leg locally when Docker isn't reachable. */
const isDockerReady = await isDockerAvailable();

/**
 * Per-dialect ceiling for one run (provisioning + spec + teardown), in ms. Postgres spins up a real
 * Testcontainers container (plus the Ryuk reaper) which far exceeds bun's 5s default; SQLite is a
 * local temp file and needs almost nothing.
 */
const PROVISION_TIMEOUT_MS: Record<Dialect, number> = {
	postgres: 60_000,
	sqlite: 5_000,
};

/** What a behavioral spec receives: a Glaze instance wired through both seams for one target. */
export interface MatrixContext {
	/** The dialect this run is executing against. */
	dialect: Dialect;
	/** The isolated database for this test, from the dialect seam. */
	db: DatabaseHandle;
	/** A silent logger for the harness instance. */
	logger: Logger;
}

/**
 * Expands one behavioral spec across every dialect in the matrix (looped in-process). Each run
 * gets a freshly provisioned, isolated database and tears it down afterward — this is the socket
 * every feature plugs into.
 *
 * The Postgres run is skipped (loudly, never passed) when Docker is unavailable locally; CI runs
 * the full matrix.
 *
 * @param name - The spec name; the dialect is appended per run.
 * @param spec - The behavioral assertion, run once per dialect.
 */
export function matrixTest(name: string, spec: (context: MatrixContext) => Promise<void>): void {
	for (const dialect of DIALECTS) {
		const shouldSkip = dialect === 'postgres' && !isDockerReady;

		test.skipIf(shouldSkip)(
			`${name} [${dialect}]`,
			async () => {
				const provisioned = await provisionDatabase(dialect);
				const logger = createLogger({ name: 'harness', level: 'silent' });

				try {
					await spec({ dialect, db: provisioned.handle, logger });
				} finally {
					await provisioned.teardown();
				}
			},
			PROVISION_TIMEOUT_MS[dialect],
		);
	}
}
