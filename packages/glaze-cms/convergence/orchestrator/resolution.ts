/**
 * The human-in-the-loop resolution engine. Repeatedly computes a drizzle envelope, and whenever it
 * needs a decision, asks the injected {@link Resolver} and re-computes with the accumulated hints —
 * until drizzle returns a terminal result, a human rejects, or a safety bound is hit. Pure over its
 * two injected seams (`compute`, `resolve`), so it is fully testable without drizzle or a database.
 *
 * Every failure is a typed {@link ResolvedOutcome}, never a thrown exception: a bad resolution or a
 * failing `compute`/`resolve` becomes an `error` result, so nothing escapes the promise contract.
 */

import { decodeEnvelope } from '../envelope/index.ts';

import type { SchemaDecision } from '../envelope/index.ts';
import type {
	DecisionResolution,
	EnvelopeCompute,
	Hint,
	ResolvedOutcome,
	Resolver,
} from './types.ts';

/** Options for {@link resolveWithDecisions}. */
export interface ResolveOptions {
	/** Maximum decision rounds before giving up as `unresolved`, so a stuck loop terminates. Defaults to 10. */
	readonly maxRounds?: number;
}

/** The result of resolving one round's decisions. */
type CollectResult =
	| { readonly kind: 'ok' }
	| { readonly kind: 'rejected'; readonly decision: SchemaDecision }
	| { readonly kind: 'invalid'; readonly decision: SchemaDecision; readonly action: string };

/**
 * Drives the compute → decide → re-compute loop until it terminates. After the final round of
 * resolutions, a further `compute` is always issued (so a resolution that takes exactly `maxRounds`
 * rounds still gets its terminal result).
 *
 * @param compute - Injected: produces a drizzle envelope for the accumulated hints.
 * @param resolve - Injected: how a human resolves each surfaced decision.
 * @param options - Optional decision-round bound.
 * @returns The resolved outcome (ok / no_changes / rejected / unresolved / error).
 */
export async function resolveWithDecisions(
	compute: EnvelopeCompute,
	resolve: Resolver,
	options: ResolveOptions = {},
): Promise<ResolvedOutcome> {
	const maxRounds = options.maxRounds ?? 10;
	const hints: Hint[] = [];
	let lastDecisions: readonly SchemaDecision[] = [];

	try {
		for (let round = 0; round <= maxRounds; round++) {
			// Sequential by design: each round depends on the previous round's resolutions. A defensive
			// copy is passed so a `compute` that reads its argument lazily can't observe later mutations.
			// oxlint-disable-next-line no-await-in-loop
			const result = decodeEnvelope(await compute([...hints]));

			if (result.status !== 'needs_decision') return result;

			// Defensive: the decoder fails closed on undecodable decisions, so this should not occur —
			// but never spin on an empty decision set.
			if (result.decisions.length === 0) {
				return {
					status: 'error',
					code: 'invalid_hints',
					rawCode: '',
					detail: 'no decodable decisions to resolve',
				};
			}

			lastDecisions = result.decisions;
			if (round === maxRounds) return { status: 'unresolved', decisions: lastDecisions };

			// oxlint-disable-next-line no-await-in-loop
			const collected = await collectHints(result.decisions, resolve, hints);
			if (collected.kind === 'rejected')
				return { status: 'rejected', decision: collected.decision };
			if (collected.kind === 'invalid') {
				return {
					status: 'error',
					code: 'invalid_hints',
					rawCode: '',
					detail: `'${collected.action}' cannot resolve a ${collected.decision.type} decision`,
				};
			}
		}

		return { status: 'unresolved', decisions: lastDecisions };
	} catch (error) {
		// A failing `compute` (drizzle/infra) or `resolve` (e.g. a dropped connection) is contained.
		return {
			status: 'error',
			code: 'internal',
			rawCode: '',
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Resolves every decision in a round, appending the resulting hints. Reports the first decision that
 * a human rejected or that a resolution could not answer; otherwise `ok`.
 *
 * @param decisions - The decisions to resolve this round.
 * @param resolve - The injected resolver.
 * @param hints - The accumulating hints array (mutated in place).
 * @returns How the round resolved.
 */
async function collectHints(
	decisions: readonly SchemaDecision[],
	resolve: Resolver,
	hints: Hint[],
): Promise<CollectResult> {
	for (const decision of decisions) {
		// oxlint-disable-next-line no-await-in-loop
		const resolution = await resolve(decision);
		if (resolution.action === 'reject') return { kind: 'rejected', decision };

		const hint = toHint(decision, resolution);
		if (hint === null) return { kind: 'invalid', decision, action: resolution.action };
		hints.push(hint);
	}
	return { kind: 'ok' };
}

/**
 * Builds the drizzle {@link Hint} for a resolved decision, or `null` when the resolution's action
 * does not match the decision kind (`rename`/`create` for `rename_or_create`; `confirm` for
 * `confirm_data_loss`). The caller turns a `null` into a typed `invalid_hints` outcome.
 *
 * @param decision - The decision being resolved.
 * @param resolution - The human's answer (never `reject` — handled earlier).
 * @returns The hint, or `null` on a mismatch.
 */
function toHint(decision: SchemaDecision, resolution: DecisionResolution): Hint | null {
	if (decision.type === 'rename_or_create') {
		if (resolution.action === 'rename') {
			// from = the deleted target the human chose; to = the new target. Empirically verified against
			// drizzle rc.4 (RENAME COLUMN <from> TO <to>); see specs/research/drizzle-kit-rc-1.0-sdk.md §3.
			return {
				type: 'rename',
				kind: decision.targetKind,
				from: resolution.from,
				to: decision.target,
			};
		}
		if (resolution.action === 'create') {
			return { type: 'create', kind: decision.targetKind, entity: decision.target };
		}
		return null;
	}

	if (resolution.action === 'confirm') {
		return { type: 'confirm_data_loss', kind: decision.targetKind, entity: decision.target };
	}
	return null;
}
