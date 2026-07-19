import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { GlazeConfig } from './types.ts';

/** Default config file name, resolved relative to the current working directory. */
const DEFAULT_CONFIG_FILE = 'glaze.config.ts';

/**
 * Loads a `glaze.config.ts` and returns its default export, without booting the server.
 *
 * The config module is expected to be side-effect-free (just a `defineGlazeConfig(...)` default
 * export), so tooling like the convergence CLI can read it cheaply.
 *
 * @param path - Path to the config file, relative to `process.cwd()`.
 * @returns The exported {@link GlazeConfig}.
 * @throws If the file has no default export.
 */
export async function loadConfig(path = DEFAULT_CONFIG_FILE): Promise<GlazeConfig> {
	const absolutePath = resolve(process.cwd(), path);
	const module = (await import(pathToFileURL(absolutePath).href)) as {
		default?: GlazeConfig;
	};

	if (!module.default) {
		throw new Error(
			`Glaze config at "${path}" must have a default export (use defineGlazeConfig).`,
		);
	}

	return module.default;
}
