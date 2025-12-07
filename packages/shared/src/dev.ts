/**
 * Glaze CMS Development Utilities
 *
 * Shared utilities for running Glaze in development mode.
 * Each example/project should have its own dev entry point.
 */

import { GLAZE_VERSION } from './index';
import type { GlazeServer } from '@glaze/core';

/**
 * Start the Glaze server with nice formatted output
 */
export function startDevServer(glaze: GlazeServer, port: number = 4000) {
	glaze.listen(port, () => {
		const api = `http://localhost:${port.toString()}/api`;
		const health = `${api}/health`;
		const ready = `${api}/ready`;

		// eslint-disable-next-line no-console
		console.info(`
┌─────────────────────────────────────────────────────┐
│  🍰  Glaze CMS v${GLAZE_VERSION}                               │
├─────────────────────────────────────────────────────┤
│  API:     ${api.padEnd(41)} │
│  Health:  ${health.padEnd(41)} │
│  Ready:   ${ready.padEnd(41)} │
└─────────────────────────────────────────────────────┘
`);
	});
}
