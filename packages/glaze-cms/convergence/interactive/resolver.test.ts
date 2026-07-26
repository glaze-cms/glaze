import { PassThrough } from 'node:stream';

import { expect, test } from '#harness';

import { askLine, createInteractiveResolver, type ResolverIo } from './resolver.ts';

import type { UnexpectedRowLoss } from '../apply/index.ts';
import type { SchemaDecision } from '../envelope/index.ts';
import type { DataLossFinding } from '../safety/index.ts';

/**
 * Builds a scripted {@link ResolverIo} that records every prompt and replies with a fixed answer.
 *
 * @param answer - The reply every `ask` returns.
 * @param isTty - Whether to report an interactive terminal (default `true`).
 * @returns The io plus the captured prompts.
 */
function scriptedIo(answer: string, isTty = true): { io: ResolverIo; prompts: string[] } {
	const prompts: string[] = [];
	const io: ResolverIo = {
		ask: async (prompt) => {
			prompts.push(prompt);
			return answer;
		},
		isTty: () => isTty,
	};
	return { io, prompts };
}

const RENAME_DECISION: SchemaDecision = {
	type: 'rename_or_create',
	entityKind: 'column',
	entity: ['public', 'users', 'handle'],
};

const DATA_LOSS_DECISION: SchemaDecision = {
	type: 'confirm_data_loss',
	entityKind: 'table',
	entity: ['public', 'users'],
	reason: 'non_empty',
};

const TABLE_LOSS: UnexpectedRowLoss = { table: 'posts', before: 10, after: 0, vanished: true };

const COLUMN_DROP: DataLossFinding = {
	change: { kind: 'drop_column', table: 'users', column: 'bio' },
	code: 'column_has_data',
	affectedRows: 5,
};

test('resolve treats a typed name as a rename, swapping it into the entity namespace', async () => {
	const { io } = scriptedIo('login');
	const resolution = await createInteractiveResolver(io).resolve(RENAME_DECISION);
	expect(resolution.action).toBe('rename');
	expect((resolution as { from: readonly string[] }).from).toEqual(['public', 'users', 'login']);
});

test('resolve treats a blank answer as create', async () => {
	const { io } = scriptedIo('   ');
	const resolution = await createInteractiveResolver(io).resolve(RENAME_DECISION);
	expect(resolution.action).toBe('create');
});

test('resolve declines a rename decision to create when non-interactive, without prompting', async () => {
	const { io, prompts } = scriptedIo('login', false);
	const resolution = await createInteractiveResolver(io).resolve(RENAME_DECISION);
	expect(resolution.action).toBe('create');
	expect(prompts).toHaveLength(0);
});

test('resolve confirms a data-loss decision on yes', async () => {
	const { io } = scriptedIo('y');
	const resolution = await createInteractiveResolver(io).resolve(DATA_LOSS_DECISION);
	expect(resolution.action).toBe('confirm');
});

test('resolve rejects a data-loss decision on anything but yes', async () => {
	const { io } = scriptedIo('n');
	const resolution = await createInteractiveResolver(io).resolve(DATA_LOSS_DECISION);
	expect(resolution.action).toBe('reject');
});

test('resolve rejects a data-loss decision when non-interactive, without prompting', async () => {
	const { io, prompts } = scriptedIo('y', false);
	const resolution = await createInteractiveResolver(io).resolve(DATA_LOSS_DECISION);
	expect(resolution.action).toBe('reject');
	expect(prompts).toHaveLength(0);
});

test('confirmLoss returns true only on an affirmative answer', async () => {
	const yes = await createInteractiveResolver(scriptedIo('yes').io).confirmLoss(TABLE_LOSS);
	const no = await createInteractiveResolver(scriptedIo('n').io).confirmLoss(TABLE_LOSS);
	expect(yes).toBe(true);
	expect(no).toBe(false);
});

test('confirmLoss declines when non-interactive, without prompting', async () => {
	const { io, prompts } = scriptedIo('yes', false);
	const confirmed = await createInteractiveResolver(io).confirmLoss(TABLE_LOSS);
	expect(confirmed).toBe(false);
	expect(prompts).toHaveLength(0);
});

test('confirmDrop returns true only on an affirmative answer', async () => {
	const yes = await createInteractiveResolver(scriptedIo('y').io).confirmDrop(COLUMN_DROP);
	const no = await createInteractiveResolver(scriptedIo('').io).confirmDrop(COLUMN_DROP);
	expect(yes).toBe(true);
	expect(no).toBe(false);
});

test('confirmDrop declines when non-interactive, without prompting', async () => {
	const { io, prompts } = scriptedIo('y', false);
	const confirmed = await createInteractiveResolver(io).confirmDrop(COLUMN_DROP);
	expect(confirmed).toBe(false);
	expect(prompts).toHaveLength(0);
});

test('prompts render the entity and never leak the underlying tool name', async () => {
	const { io, prompts } = scriptedIo('n');
	await createInteractiveResolver(io).resolve(DATA_LOSS_DECISION);
	expect(prompts[0]).toContain('public.users');
	expect(prompts[0]).toContain('will discard existing data');
	expect((prompts[0] as string).toLowerCase().includes('drizzle')).toBe(false);
});

test('an unknown data-loss reason shows no reason detail line', async () => {
	const { io, prompts } = scriptedIo('n');
	const unknownReason: SchemaDecision = {
		type: 'confirm_data_loss',
		entityKind: 'table',
		entity: ['public', 'users'],
		reason: 'unknown',
	};
	await createInteractiveResolver(io).resolve(unknownReason);
	expect((prompts[0] as string).includes('undefined')).toBe(false);
	expect(prompts[0]).toContain('will discard existing data');
});

test('askLine returns the typed line', async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	const pending = askLine(input, output, 'q: ');
	input.write('hello\n');
	expect(await pending).toBe('hello');
});

// EOF (Ctrl-D / a closed stream) must resolve to an empty answer so every seam declines — otherwise
// an interactive boot hangs forever at a prompt (the `question` promise never settles on Bun).
test('askLine resolves to empty on EOF, so callers fail closed', async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	const pending = askLine(input, output, 'q: ');
	input.end();
	expect(await pending).toBe('');
});
