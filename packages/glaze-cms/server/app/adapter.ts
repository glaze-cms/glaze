/**
 * The HTTP-server adapter seam. Elysia owns this seam (CLAUDE.md §5): the `@elysia/node` adapter runs the
 * app on Node, while Bun uses Elysia's default adapter. Resolved from the runtime seam's name.
 */

import { node } from '@elysia/node';

import type { RuntimeName } from '#runtime';

/**
 * Selects the Elysia HTTP adapter for the runtime.
 *
 * @param runtime - The runtime name (`bun` or `node`).
 * @returns The Node adapter on Node; `undefined` (Elysia's default Bun adapter) otherwise.
 */
export function selectAdapter(runtime: RuntimeName) {
	return runtime === 'node' ? node() : undefined;
}
