import type { Dialect } from '../dialect/index.ts';

export type { Dialect } from '../dialect/index.ts';

/**
 * The dialects every behavioral spec is expanded across, looped in-process by
 * {@link matrixTest}. The runtime dimension (Bun/Node) is the CI job matrix, not looped here.
 */
export const DIALECTS: Dialect[] = ['postgres', 'sqlite'];
