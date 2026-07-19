import { bunRuntime } from './bun.ts';
import { nodeRuntime } from './node.ts';

import type { Runtime } from './types.ts';

export type { Runtime, RuntimeName, SpawnOptions, SpawnResult } from './types.ts';

/**
 * Reports whether the current process is running under Bun.
 * @returns `true` when the `Bun` global is present.
 */
function isBun(): boolean {
	return typeof globalThis.Bun !== 'undefined';
}

/**
 * Resolves the runtime seam once, returning the native-fast adapter for the current runtime.
 *
 * Call this at the composition root and inject the result inward; downstream logic depends on
 * the {@link Runtime} interface, never on which runtime is active.
 *
 * @returns The Bun adapter under Bun, otherwise the Node adapter.
 */
export function resolveRuntime(): Runtime {
	return isBun() ? bunRuntime : nodeRuntime;
}
