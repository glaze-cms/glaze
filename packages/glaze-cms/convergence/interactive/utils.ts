import type { DataLossReason, SchemaDecision } from '../envelope/index.ts';

/** Minimum inner width of a rendered panel, so short prompts still read as a framed block. */
const PANEL_MIN_WIDTH = 52;

/** Human-readable text for each known destructive reason (the `unknown` reason has no specific line). */
const REASON_TEXT: Record<DataLossReason, string> = {
	non_empty: 'the target is not empty, so existing rows are affected',
	table_recreate: 'the table is recreated, so its rows are rewritten',
	type_change: 'the column type changes, so existing values are rewritten',
};

/**
 * Whether an answer affirms a `[y/N]` prompt. Defaults to No: only `y`/`yes` (any case) confirm.
 *
 * @param answer - The raw reply.
 * @returns `true` for an affirmative answer.
 */
export function isAffirmative(answer: string): boolean {
	const normalized = answer.trim().toLowerCase();
	return normalized === 'y' || normalized === 'yes';
}

/**
 * Builds the `from` tuple for a rename: the new target's namespace with the typed old name swapped
 * into the final (leaf) slot — e.g. `['public','users','handle']` + `login` ⇒ `['public','users','login']`.
 *
 * @param target - The new target's namespaced identifier tuple.
 * @param oldName - The existing target's leaf name the operator typed.
 * @returns The old target's namespaced identifier tuple.
 */
export function renameFrom(target: readonly string[], oldName: string): readonly string[] {
	return [...target.slice(0, -1), oldName.trim()];
}

/**
 * Renders a target's namespaced tuple as a dotted path for display (`public.users.handle`).
 *
 * @param target - The namespaced identifier tuple.
 * @returns The dotted path.
 */
export function formatTarget(target: readonly string[]): string {
	return target.join('.');
}

/**
 * Describes why a `confirm_data_loss` decision is destructive, in one human-readable line. Returns
 * `null` for the `unknown` reason (a future drizzle rc Glaze doesn't classify): the panel headline
 * already states the effect, so there is no specific detail to add.
 *
 * @param decision - The `confirm_data_loss` decision.
 * @returns A short description of the reason, or `null` when there is nothing specific to say.
 */
export function describeReason(
	decision: Extract<SchemaDecision, { type: 'confirm_data_loss' }>,
): string | null {
	if (decision.reason === 'type_change' && decision.reasonDetails) {
		return `the column type changes from ${decision.reasonDetails.from} to ${decision.reasonDetails.to}`;
	}
	if (decision.reason === 'unknown') return null;
	return REASON_TEXT[decision.reason];
}

/**
 * Frames a title and body lines in a light box-drawing panel, sized to its widest line — the
 * "here's what's about to change" block. Plain text, no color, so it renders anywhere.
 *
 * @param title - The panel title, shown in the top border.
 * @param lines - The body lines (already laid out; empty strings are blank spacer rows).
 * @returns The multi-line panel string.
 */
export function formatPanel(title: string, lines: readonly string[]): string {
	const titleSegment = `─ ${title} `;
	const bodySegments = lines.map((line) => ` ${line} `);
	const inner = Math.max(
		PANEL_MIN_WIDTH,
		titleSegment.length,
		...bodySegments.map((s) => s.length),
	);

	const top = `┌${titleSegment}${'─'.repeat(inner - titleSegment.length)}┐`;
	const body = bodySegments.map((segment) => `│${segment.padEnd(inner)}│`);
	const bottom = `└${'─'.repeat(inner)}┘`;

	return [top, ...body, bottom].join('\n');
}
