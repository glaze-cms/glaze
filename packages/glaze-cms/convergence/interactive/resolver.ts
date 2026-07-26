import { createInterface } from 'node:readline/promises';

import { isEnvFlagEnabled } from '#utils';

import { describeReason, formatEntity, formatPanel, isAffirmative, renameFrom } from './utils.ts';

import type { UnexpectedRowLoss } from '../apply/index.ts';
import type { SchemaDecision } from '../envelope/index.ts';
import type {
	DecisionResolution,
	DropConfirmer,
	LossResolver,
	Resolver,
} from '../orchestrator/index.ts';
import type { DataLossFinding } from '../safety/index.ts';
import type { Readable, Writable } from 'node:stream';

/**
 * A terminal I/O port, injected so the resolver is unit-testable without a real TTY. The default
 * implementation ({@link stdioIo}) reads a line from stdin and reports whether stdin is a terminal;
 * tests pass a scripted stub.
 */
export interface ResolverIo {
	/**
	 * Prints a prompt and reads one line of input.
	 *
	 * @param prompt - The fully-rendered prompt (panel + question) to display.
	 * @returns The user's raw reply (untrimmed).
	 */
	ask(prompt: string): Promise<string>;
	/**
	 * Whether input is an interactive terminal. When `false` every prompt declines (fail-closed), so
	 * CI/prod/piped boots never hang waiting for an answer that can't come.
	 *
	 * @returns `true` if stdin is a TTY.
	 */
	isTty(): boolean;
}

/** The three human seams {@link converge} injects, bundled as one interactive implementation. */
export interface InteractiveResolver {
	/** Resolves a rename-vs-create or confirm-data-loss decision. */
	resolve: Resolver;
	/** Confirms an intended table-level data loss the apply oracle detected. */
	confirmLoss: LossResolver;
	/** Confirms a populated column drop layer-1 pre-flight flagged. */
	confirmDrop: DropConfirmer;
}

/**
 * Renders a panel and a yes/no question, defaulting to No — only an explicit `y`/`yes` confirms.
 *
 * @param io - The terminal I/O port.
 * @param panel - The rendered "about to change" panel.
 * @param question - The question shown after the panel (the `[y/N]` suffix is appended).
 * @returns `true` only for an affirmative answer.
 */
async function askYesNo(io: ResolverIo, panel: string, question: string): Promise<boolean> {
	const answer = await io.ask(`${panel}\n${question} [y/N]: `);
	return isAffirmative(answer);
}

/**
 * Asks whether a newly-appeared entity is a rename of an existing one. Non-TTY ⇒ create (additive,
 * never destructive). A blank answer ⇒ create; any name ⇒ rename, carrying the entity's namespace
 * and swapping in the typed old name.
 *
 * @param io - The terminal I/O port.
 * @param decision - The `rename_or_create` decision.
 * @returns `{ action: 'rename', from }` or `{ action: 'create' }`.
 */
async function resolveRenameOrCreate(
	io: ResolverIo,
	decision: Extract<SchemaDecision, { type: 'rename_or_create' }>,
): Promise<DecisionResolution> {
	if (!io.isTty()) return { action: 'create' };

	const { entityKind, entity } = decision;
	const panel = formatPanel('Schema change', [
		`A new ${entityKind} appeared that isn't in the database yet:`,
		'',
		`    ${formatEntity(entity)}`,
		'',
		`If you renamed an existing ${entityKind}, type its current name so its`,
		'data carries over. Otherwise press Enter to create it new.',
	]);
	const answer = (await io.ask(`${panel}\nRename from (or Enter to create): `)).trim();

	if (answer === '') return { action: 'create' };
	return { action: 'rename', from: renameFrom(entity, answer) };
}

/**
 * Asks the operator to confirm a destructive change flagged as `confirm_data_loss`. Non-TTY or a
 * non-affirmative answer ⇒ reject (the whole operation aborts). The reason line is shown only when
 * there is a specific one — the headline already states the effect.
 *
 * @param io - The terminal I/O port.
 * @param decision - The `confirm_data_loss` decision.
 * @returns `{ action: 'confirm' }` or `{ action: 'reject' }`.
 */
async function resolveDataLoss(
	io: ResolverIo,
	decision: Extract<SchemaDecision, { type: 'confirm_data_loss' }>,
): Promise<DecisionResolution> {
	if (!io.isTty()) return { action: 'reject' };

	const reason = describeReason(decision);
	const lines = [`This change to ${formatEntity(decision.entity)} will discard existing data.`];
	if (reason) lines.push('', `    ${reason}`);

	const confirmed = await askYesNo(io, formatPanel('Confirm data loss', lines), 'Proceed?');
	return confirmed ? { action: 'confirm' } : { action: 'reject' };
}

/**
 * Resolves one schema decision at the terminal, or declines when non-interactive.
 *
 * @param io - The terminal I/O port.
 * @param decision - The decision the diff surfaced.
 * @returns How to resolve it: a rename/create for ambiguity, a confirm/reject for data loss.
 */
async function resolveDecision(
	io: ResolverIo,
	decision: SchemaDecision,
): Promise<DecisionResolution> {
	if (decision.type === 'rename_or_create') return resolveRenameOrCreate(io, decision);
	return resolveDataLoss(io, decision);
}

/**
 * Confirms an intended table-level data loss the apply oracle measured (a dropped or truncated
 * table). Non-TTY or a non-affirmative answer ⇒ `false` (decline; the migration rolls back).
 *
 * @param io - The terminal I/O port.
 * @param loss - The measured row loss (table, before/after counts, whether it vanished).
 * @returns `true` to proceed and accept the loss, `false` to decline.
 */
async function confirmTableLoss(io: ResolverIo, loss: UnexpectedRowLoss): Promise<boolean> {
	if (!io.isTty()) return false;

	const headline = loss.vanished
		? `Table "${loss.table}" would be dropped entirely.`
		: `Table "${loss.table}" would lose rows.`;
	const panel = formatPanel('Unexpected data loss', [
		headline,
		'',
		`    rows: ${loss.before} → ${loss.after}`,
	]);
	return askYesNo(io, panel, 'Proceed and lose this data?');
}

/**
 * Confirms a populated column drop layer-1 pre-flight flagged (its values are destroyed silently,
 * below the row-count oracle). Non-TTY or a non-affirmative answer ⇒ `false` (declined; boot blocks).
 *
 * @param io - The terminal I/O port.
 * @param finding - The data-loss finding (the change plus its affected row count).
 * @returns `true` to drop the column, `false` to decline.
 */
async function confirmColumnDrop(io: ResolverIo, finding: DataLossFinding): Promise<boolean> {
	if (!io.isTty()) return false;

	const { table, column } = finding.change;
	const affected = finding.affectedRows ?? 'an unknown number of';
	const panel = formatPanel('Confirm column drop', [
		`Dropping "${table}"."${column}" will destroy its data.`,
		'',
		`    rows affected: ${affected}`,
	]);
	return askYesNo(io, panel, 'Drop the column and its data?');
}

/**
 * Prints a prompt and reads one line, resolving to `''` on EOF so callers fail closed. A fresh
 * readline interface is created per call and closed after, so sequential prompts don't hold the
 * stream open. On EOF (Ctrl-D / a closed stream) `question` never settles under Bun — but the
 * readline `close` event fires on both Bun and Node, so racing the two settles identically on every
 * runtime: an empty answer, which every seam reads as a decline. (Without this, an interactive Bun
 * boot would hang forever at a prompt on Ctrl-D.)
 *
 * @param input - The input stream to read a line from (stdin in production).
 * @param output - The output stream to print the prompt to (stdout in production).
 * @param prompt - The fully-rendered prompt to display.
 * @returns The typed line, or `''` on EOF.
 */
export async function askLine(input: Readable, output: Writable, prompt: string): Promise<string> {
	const rl = createInterface({ input, output });
	try {
		return await new Promise<string>((resolve) => {
			let settled = false;
			const settle = (value: string): void => {
				if (settled) return;
				settled = true;
				resolve(value);
			};
			rl.once('close', () => settle(''));
			rl.question(prompt).then(settle, () => settle(''));
		});
	} finally {
		rl.close();
	}
}

/**
 * Whether the process can prompt a human: stdin is a TTY **and** no non-interactive signal is set.
 * `CI` (set by every mainstream CI system) or `GLAZE_NO_TTY` (the explicit escape hatch for a container
 * that allocates a TTY with no human on it — `docker run -t` without `-i`, some process managers) each
 * force `false`, so every prompt declines (fails closed) instead of blocking boot forever on an answer
 * that can't come.
 *
 * @returns `true` when it is safe to prompt interactively.
 */
export function isInteractive(): boolean {
	if (isEnvFlagEnabled('CI') || isEnvFlagEnabled('GLAZE_NO_TTY')) return false;
	return process.stdin.isTTY;
}

/**
 * The default {@link ResolverIo}: reads a line from stdin via {@link askLine} and reports interactivity
 * via {@link isInteractive}. Cross-runtime (Bun and Node).
 *
 * @returns A stdio-backed I/O port.
 */
function stdioIo(): ResolverIo {
	return {
		ask: (prompt) => askLine(process.stdin, process.stdout, prompt),
		isTty: isInteractive,
	};
}

/**
 * Creates the interactive resolver: plain-text terminal prompts that render "here's what's about to
 * change" as a framed block and drive convergence's rename/create/confirm decisions. I/O is injected
 * ({@link ResolverIo}) so it is testable without a terminal and reusable by a future `glaze migrate`
 * CLI. When stdin is **not** a TTY every prompt declines (create for renames, reject/`false` for
 * confirmations), so non-interactive boots fail closed instead of hanging or losing data.
 *
 * @param io - The terminal I/O port. Defaults to real stdio ({@link stdioIo}).
 * @returns The `{ resolve, confirmLoss, confirmDrop }` seams to pass to {@link converge}.
 */
export function createInteractiveResolver(io: ResolverIo = stdioIo()): InteractiveResolver {
	return {
		resolve: (decision) => resolveDecision(io, decision),
		confirmLoss: (loss) => confirmTableLoss(io, loss),
		confirmDrop: (finding) => confirmColumnDrop(io, finding),
	};
}
