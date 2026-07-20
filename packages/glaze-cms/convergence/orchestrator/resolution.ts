/**
 * The human-in-the-loop resolution engine. Repeatedly computes a drizzle envelope, and whenever it
 * needs a decision, asks the injected {@link Resolver} and re-computes with the accumulated hints —
 * until drizzle returns a terminal result, a human rejects, or a safety bound is hit. Pure over its
 * two injected seams (`compute`, `resolve`), so it is fully testable without drizzle or a database.
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
	/** Safety bound on re-invocations, so an unresolvable loop terminates. Defaults to 10. */
	readonly maxRounds?: number;
}

/**
 * Drives the compute → decide → re-compute loop until it terminates.
 *
 * @param compute - Injected: produces a drizzle envelope for the accumulated hints.
 * @param resolve - Injected: how a human resolves each surfaced decision.
 * @param options - Optional safety bound.
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

	for (let round = 0; round < maxRounds; round++) {
		// Sequential by design: each round depends on the previous round's resolutions.
		// oxlint-disable-next-line no-await-in-loop
		const result = decodeEnvelope(await compute(hints));

		if (result.status !== 'needs_decision') {
			return toTerminalOutcome(result);
		}

		lastDecisions = result.decisions;
		// oxlint-disable-next-line no-await-in-loop
		const rejection = await collectHints(result.decisions, resolve, hints);
		if (rejection !== null) return { status: 'rejected', decision: rejection };
	}

	return { status: 'unresolved', decisions: lastDecisions };
}

/**
 * Resolves every decision in a round, appending the resulting hints. Returns the first decision a
 * human rejected, or `null` when all were resolved.
 *
 * @param decisions - The decisions to resolve this round.
 * @param resolve - The injected resolver.
 * @param hints - The accumulating hints array (mutated in place).
 * @returns The rejected decision, or `null` if none.
 */
async function collectHints(
	decisions: readonly SchemaDecision[],
	resolve: Resolver,
	hints: Hint[],
): Promise<SchemaDecision | null> {
	for (const decision of decisions) {
		// oxlint-disable-next-line no-await-in-loop
		const resolution = await resolve(decision);
		if (resolution.action === 'reject') return decision;
		hints.push(toHint(decision, resolution));
	}
	return null;
}

/**
 * Maps a drizzle terminal envelope result to a {@link ResolvedOutcome}.
 *
 * @param result - A decoded, non-`needs_decision` operation result.
 * @returns The matching outcome.
 */
function toTerminalOutcome(
	result: Exclude<ReturnType<typeof decodeEnvelope>, { status: 'needs_decision' }>,
): ResolvedOutcome {
	switch (result.status) {
		case 'ok':
			return result.migrationPath === undefined
				? { status: 'ok', statements: result.statements }
				: { status: 'ok', statements: result.statements, migrationPath: result.migrationPath };
		case 'no_changes':
			return { status: 'no_changes' };
		case 'error':
			return result.detail === undefined
				? { status: 'error', code: result.code, rawCode: result.rawCode }
				: { status: 'error', code: result.code, rawCode: result.rawCode, detail: result.detail };
		default: {
			const unexpected: never = result;
			throw new Error(`Unexpected terminal status: ${JSON.stringify(unexpected)}`);
		}
	}
}

/**
 * Builds the drizzle {@link Hint} for a resolved decision. The resolution's action must match the
 * decision kind (`rename`/`create` for `rename_or_create`; `confirm` for `confirm_data_loss`).
 *
 * @param decision - The decision being resolved.
 * @param resolution - The human's answer (never `reject` — handled earlier).
 * @returns The hint to send back to drizzle.
 * @throws {Error} If the resolution action does not match the decision kind.
 */
function toHint(decision: SchemaDecision, resolution: DecisionResolution): Hint {
	if (decision.type === 'rename_or_create') {
		if (resolution.action === 'rename') {
			return {
				type: 'rename',
				kind: decision.entityKind,
				from: resolution.from,
				to: decision.entity,
			};
		}
		if (resolution.action === 'create') {
			return { type: 'create', kind: decision.entityKind, entity: decision.entity };
		}
		throw new Error(
			`rename_or_create needs a 'rename' or 'create' resolution, got '${resolution.action}'`,
		);
	}

	if (resolution.action === 'confirm') {
		return { type: 'confirm_data_loss', kind: decision.entityKind, entity: decision.entity };
	}
	throw new Error(`confirm_data_loss needs a 'confirm' resolution, got '${resolution.action}'`);
}
