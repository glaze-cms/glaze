/**
 * Orchestrator types — the injection seams that make convergence testable before any API or admin
 * UI exists. The human-in-the-loop is a pair of injected functions (`resolve`, later `approve`);
 * drizzle and the database are real, never mocked. See `docs/convergence-design.md`.
 */

import type { ConvergenceErrorCode, SchemaDecision } from '../envelope/index.ts';

/**
 * A reply Glaze sends back to drizzle to resolve one decision. Mirrors drizzle's `Hint` shape (see
 * `docs/research/drizzle-kit-rc-1.0-sdk.md` §3); written to a hints file when re-invoking `generate`.
 */
export type Hint =
	| {
			readonly type: 'rename';
			readonly kind: string;
			readonly from: readonly string[];
			readonly to: readonly string[];
	  }
	| { readonly type: 'create'; readonly kind: string; readonly entity: readonly string[] }
	| {
			readonly type: 'confirm_data_loss';
			readonly kind: string;
			readonly entity: readonly string[];
	  };

/**
 * How a human answers one {@link SchemaDecision}. `rename`/`create` answer a `rename_or_create`;
 * `confirm`/`reject` answer a `confirm_data_loss`. `reject` aborts the whole operation.
 */
export type DecisionResolution =
	| { readonly action: 'rename'; readonly from: readonly string[] }
	| { readonly action: 'create' }
	| { readonly action: 'confirm' }
	| { readonly action: 'reject' };

/**
 * The injected human seam. Given a decision surfaced by drizzle, returns how to resolve it. In
 * production this is the admin UI (API response) or the developer's CLI; in tests it's a
 * deterministic stub. May be async (a real human takes time).
 *
 * @param decision - The decision to resolve.
 * @returns The resolution (may be a promise).
 */
export type Resolver = (
	decision: SchemaDecision,
) => DecisionResolution | Promise<DecisionResolution>;

/**
 * Produces a fresh drizzle envelope for the given accumulated hints. Injected so the resolution loop
 * is pure: in production this invokes `drizzle-kit/cli generate`; in tests it's a stub returning
 * canned envelopes.
 *
 * @param hints - All hints resolved so far.
 * @returns The raw drizzle envelope (decoded by the loop).
 */
export type EnvelopeCompute = (hints: readonly Hint[]) => Promise<unknown>;

/**
 * The outcome of the resolution loop — drizzle's result once every decision has been resolved, plus
 * the two human-driven terminal states (`rejected`, `unresolved`).
 */
export type ResolvedOutcome =
	| {
			readonly status: 'ok';
			readonly statements: readonly string[];
			readonly migrationPath?: string;
	  }
	| { readonly status: 'no_changes' }
	| { readonly status: 'rejected'; readonly decision: SchemaDecision }
	| { readonly status: 'unresolved'; readonly decisions: readonly SchemaDecision[] }
	| {
			readonly status: 'error';
			readonly code: ConvergenceErrorCode;
			readonly rawCode: string;
			readonly detail?: string;
	  };
