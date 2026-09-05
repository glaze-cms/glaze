import { expect, test } from '../../harness/index.ts';
import { resolveWithDecisions } from './index.ts';

import type { SchemaDecision } from '../envelope/index.ts';
import type { EnvelopeCompute, Hint, Resolver } from './index.ts';

// Pure specs: the loop is exercised over injected `compute` (canned drizzle envelopes) and `resolve`
// (a stub human). No drizzle, no database — exactly how the orchestrator stays testable before the
// API and admin UI exist.

const OK = { status: 'ok', dialect: 'sqlite', statements: ['ALTER TABLE "users" RENAME ...'] };
const NO_CHANGES = { status: 'no_changes', dialect: 'sqlite' };
const RENAME = {
	status: 'missing_hints',
	unresolved: [{ type: 'rename_or_create', kind: 'column', entity: ['public', 'users', 'handle'] }],
};
const DATA_LOSS = {
	status: 'missing_hints',
	unresolved: [
		{
			type: 'confirm_data_loss',
			kind: 'column',
			entity: ['public', 'users', 'nickname'],
			reason: 'non_empty',
		},
	],
};
const ERROR = { status: 'error', error: { code: 'query_error', message: 'boom' } };

/** A compute stub that returns the scripted envelopes in order (repeating the last), recording the hints it saw. */
function scripted(envelopes: readonly unknown[]): { compute: EnvelopeCompute; calls: Hint[][] } {
	const calls: Hint[][] = [];
	let index = 0;
	const compute: EnvelopeCompute = (hints) => {
		calls.push([...hints]);
		const envelope = envelopes[Math.min(index, envelopes.length - 1)];
		index += 1;
		return Promise.resolve(envelope);
	};
	return { compute, calls };
}

test('returns ok immediately when nothing needs deciding', async () => {
	const { compute, calls } = scripted([OK]);
	const outcome = await resolveWithDecisions(compute, () => ({ action: 'create' }));

	expect(outcome.status).toBe('ok');
	if (outcome.status === 'ok')
		expect(outcome.statements).toEqual(['ALTER TABLE "users" RENAME ...']);
	expect(calls).toHaveLength(1);
	expect(calls[0]).toEqual([]); // first invocation carries no hints
});

test('returns no_changes', async () => {
	const { compute } = scripted([NO_CHANGES]);
	const outcome = await resolveWithDecisions(compute, () => ({ action: 'create' }));
	expect(outcome.status).toBe('no_changes');
});

test('resolves a rename, then succeeds, passing the rename hint back', async () => {
	const { compute, calls } = scripted([RENAME, OK]);
	let seen: SchemaDecision | undefined;
	const resolve: Resolver = (decision) => {
		seen = decision;
		return { action: 'rename', from: ['public', 'users', 'nickname'] };
	};

	const outcome = await resolveWithDecisions(compute, resolve);

	expect(seen?.type).toBe('rename_or_create');
	expect(outcome.status).toBe('ok');
	expect(calls[1]).toEqual([
		{
			type: 'rename',
			kind: 'column',
			from: ['public', 'users', 'nickname'],
			to: ['public', 'users', 'handle'],
		},
	]);
});

test('confirms a data-loss decision, passing the confirm hint back', async () => {
	const { compute, calls } = scripted([DATA_LOSS, OK]);
	const outcome = await resolveWithDecisions(compute, () => ({ action: 'confirm' }));

	expect(outcome.status).toBe('ok');
	expect(calls[1]).toEqual([
		{ type: 'confirm_data_loss', kind: 'column', entity: ['public', 'users', 'nickname'] },
	]);
});

test('a rejected decision aborts with that decision', async () => {
	const { compute } = scripted([DATA_LOSS, OK]);
	const outcome = await resolveWithDecisions(compute, () => ({ action: 'reject' }));

	expect(outcome.status).toBe('rejected');
	if (outcome.status === 'rejected') {
		expect(outcome.decision.type).toBe('confirm_data_loss');
		expect(outcome.decision.target).toEqual(['public', 'users', 'nickname']);
	}
});

test('maps a drizzle error through', async () => {
	const { compute } = scripted([ERROR]);
	const outcome = await resolveWithDecisions(compute, () => ({ action: 'create' }));

	expect(outcome.status).toBe('error');
	if (outcome.status === 'error') {
		expect(outcome.code).toBe('query_error');
		expect(outcome.detail).toBe('boom');
	}
});

test('gives up as unresolved past the round bound', async () => {
	const { compute } = scripted([DATA_LOSS]); // compute never accepts the resolution
	const outcome = await resolveWithDecisions(compute, () => ({ action: 'confirm' }), {
		maxRounds: 3,
	});

	expect(outcome.status).toBe('unresolved');
	if (outcome.status === 'unresolved') expect(outcome.decisions).toHaveLength(1);
});

test('returns an invalid_hints error when a resolution does not match the decision kind', async () => {
	const { compute } = scripted([RENAME, OK]);
	const outcome = await resolveWithDecisions(compute, () => ({ action: 'confirm' })); // invalid for rename_or_create

	expect(outcome.status).toBe('error');
	if (outcome.status === 'error') expect(outcome.code).toBe('invalid_hints');
});

test('contains a throwing resolver as an internal error, never an unhandled rejection', async () => {
	const { compute } = scripted([DATA_LOSS, OK]);
	const outcome = await resolveWithDecisions(compute, () => {
		throw new Error('resolver blew up');
	});

	expect(outcome.status).toBe('error');
	if (outcome.status === 'error') {
		expect(outcome.code).toBe('internal');
		expect(outcome.detail).toBe('resolver blew up');
	}
});

test('issues a final compute after the last round — no off-by-one', async () => {
	// Two decision rounds then ok, with maxRounds exactly 2. The old loop stopped short and reported
	// `unresolved`; the fixed loop issues the terminal compute and succeeds.
	const { compute } = scripted([RENAME, RENAME, OK]);
	const outcome = await resolveWithDecisions(
		compute,
		() => ({ action: 'rename', from: ['public', 'users', 'nickname'] }),
		{ maxRounds: 2 },
	);

	expect(outcome.status).toBe('ok');
});
