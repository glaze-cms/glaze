import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveDialect } from '../dialect/index.ts';
import { resolveRuntime } from '../runtime/index.ts';

import type { DatabaseHandle, Dialect } from '../dialect/index.ts';

/** A provisioned, isolated database plus the function that disposes of it. */
export interface ProvisionedDatabase {
	/** The live database handle, wired through the dialect seam. */
	handle: DatabaseHandle;
	/** Closes the connection and removes the container / temp file. */
	teardown: () => Promise<void>;
}

/** The Postgres image used for ephemeral test containers (pinned for reproducibility). */
const POSTGRES_IMAGE = 'postgres:16-alpine';

/**
 * Reports whether a Docker daemon is reachable, so the harness can skip the Postgres leg
 * locally when Docker isn't running (CI always has it).
 *
 * @returns `true` when `docker info` succeeds.
 */
export async function isDockerAvailable(): Promise<boolean> {
	try {
		const runtime = resolveRuntime();
		const result = await runtime.spawn(['docker', 'info']);
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Provisions an ephemeral Postgres in a throwaway Docker container via Testcontainers.
 * @returns The database handle and a teardown that stops the container.
 */
async function provisionPostgres(): Promise<ProvisionedDatabase> {
	const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
	const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
	const adapter = resolveDialect('postgres');
	const handle = await adapter.createDatabase({
		connection: container.getConnectionUri(),
	});

	return {
		handle,
		async teardown() {
			await handle.close();
			await container.stop();
		},
	};
}

/**
 * Provisions an isolated SQLite database backed by a unique temp file (not `:memory:`, so a
 * separate drizzle-kit connection could reach the same db later).
 *
 * @returns The database handle and a teardown that deletes the temp file.
 */
async function provisionSqlite(): Promise<ProvisionedDatabase> {
	const directory = mkdtempSync(join(tmpdir(), 'glaze-sqlite-'));
	const file = join(directory, 'test.db');
	const adapter = resolveDialect('sqlite');
	const handle = await adapter.createDatabase({ connection: file });

	return {
		handle,
		async teardown() {
			await handle.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

/**
 * Provisions a fresh, isolated database for a dialect, wired through the dialect seam.
 *
 * @param dialect - The dialect to provision.
 * @returns The database handle and its teardown.
 */
export async function provisionDatabase(dialect: Dialect): Promise<ProvisionedDatabase> {
	return dialect === 'postgres' ? provisionPostgres() : provisionSqlite();
}
