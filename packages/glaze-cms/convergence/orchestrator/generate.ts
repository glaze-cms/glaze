/**
 * The real {@link EnvelopeCompute}, backed by `drizzle-kit/cli generate`. drizzle computes the diff
 * and writes the migration + snapshot to `out` (a persistent, committed directory); Glaze decodes the
 * returned envelope. This is the "drizzle computes; Glaze applies" boundary — `generate` is file-only
 * (no DB driver), so it runs Bun-native with no SQLite driver at all.
 *
 * Hints are passed via a temp `hintsFile` because rc.4's inline `hints:` option is bugged (returns
 * `missing_required_params_error`) — see `docs/research/drizzle-kit-rc-1.0-sdk.md` §3.
 */

import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generate } from 'drizzle-kit/cli';

import { resolveRuntime } from '../../runtime/index.ts';

import type { Dialect } from '../../dialect/index.ts';
import type { EnvelopeCompute } from './types.ts';

/** Config for a code-origin generate compute. */
export interface GenerateConfig {
	/** The target dialect. */
	readonly dialect: Dialect;
	/** Path (or glob) to the Drizzle schema module. */
	readonly schema: string;
	/** Output directory for the migration + snapshot. */
	readonly out: string;
}

/** Glaze dialect → drizzle-kit dialect string. */
const DRIZZLE_DIALECT: Readonly<Record<Dialect, 'postgresql' | 'sqlite'>> = {
	postgres: 'postgresql',
	sqlite: 'sqlite',
};

/**
 * Builds an {@link EnvelopeCompute} that runs `drizzle-kit generate` for the accumulated hints.
 *
 * @param config - Dialect, schema path, and output directory.
 * @returns A compute returning drizzle's raw envelope (decoded by the resolution loop).
 */
export function createGenerateCompute(config: GenerateConfig): EnvelopeCompute {
	const runtime = resolveRuntime();
	const base = {
		dialect: DRIZZLE_DIALECT[config.dialect],
		schema: config.schema,
		out: config.out,
	};

	return async (hints) => {
		if (hints.length === 0) {
			return generate(base);
		}
		const hintsFile = join(tmpdir(), `glaze-hints-${randomUUID()}.json`);
		await runtime.writeFile(hintsFile, JSON.stringify(hints));
		try {
			return await generate({ ...base, hintsFile });
		} finally {
			// The hints file is single-use; drop it so per-converge temp files don't accumulate.
			rmSync(hintsFile, { force: true });
		}
	};
}
