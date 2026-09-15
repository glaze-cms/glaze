import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeChangeHash, readSnapshotChain } from '#convergence';
import { expect, matrixTest, test } from '#harness';

import { checkTargets, reconcileOpenRequest } from './reconcile.ts';

import type { ConvergeResult, SnapshotChain } from '#convergence';
import type { OpenRequest } from '../approvals/index.ts';
import type { TargetState } from './reconcile.ts';

// Pure decisions over a hand-built request, result, chain and witness: one test per branch, so the
// trail's answer for every situation is pinned rather than implied.

const DROP = ['alter table posts drop column body'];
const HASH = computeChangeHash(DROP, 'a');
const DROP_BODY = { kind: 'drop_column', table: 'posts', column: 'body' } as const;

/** A finding for a change, as the trail records it. */
function drop(change: unknown): unknown {
	return { change, code: 'column_has_data', affectedRows: 1 };
}

/** An open request for `DROP`, measured against snapshot `a` unless told otherwise. */
function request(parentSnapshotId: string | null = 'a'): OpenRequest {
	const findings = [drop(DROP_BODY)];
	return {
		requestId: 'r1',
		changeHash: HASH,
		createdAt: new Date(0),
		payload:
			parentSnapshotId === null
				? { statements: DROP, findings }
				: { parentSnapshotId, statements: DROP, findings },
	};
}

/** Writes a migration directory into `out`. */
function writeMigration(
	out: string,
	name: string,
	id: string,
	parentId: string,
	statements: readonly string[],
): void {
	mkdirSync(join(out, name), { recursive: true });
	writeFileSync(
		join(out, name, 'snapshot.json'),
		JSON.stringify({ id, prevIds: [parentId || '00000000-0000-0000-0000-000000000000'], ddl: [] }),
	);
	writeFileSync(join(out, name, 'migration.sql'), statements.join('\n--> statement-breakpoint\n'));
}

/** Builds an `out` whose head is `a`, plus whatever `more` adds on top, and reads its chain. */
function chainWith(more: (out: string) => void = () => {}): { out: string; chain: SnapshotChain } {
	const out = mkdtempSync(join(tmpdir(), 'glaze-reconcile-'));
	writeMigration(out, '0001_a', 'a', '', ['create table posts (id integer, body text)']);
	more(out);
	return { out, chain: readSnapshotChain(out) };
}

const NO_CHANGES: ConvergeResult = { status: 'no_changes' };
const APPLIED_SAME: ConvergeResult = {
	status: 'applied',
	statements: DROP,
	changeHash: HASH,
	migration: '0002_b',
};
const APPLIED_OTHER: ConvergeResult = {
	status: 'applied',
	statements: [],
	changeHash: 'other',
	migration: '0002_x',
};

/** Runs one decision with the database saying the same before and after this boot. */
function decideWith(
	out: string,
	chain: SnapshotChain,
	result: ConvergeResult,
	targets: TargetState,
) {
	return reconcileOpenRequest(request(), result, out, chain, { before: targets, after: targets });
}

test('a request without its parent snapshot is left open, whatever this boot found', () => {
	const { out, chain } = chainWith();
	try {
		for (const result of [NO_CHANGES, APPLIED_SAME]) {
			const decided = reconcileOpenRequest(request(null), result, out, chain, {
				before: 'gone',
				after: 'gone',
			});
			expect(decided.outcome).toBe('unknown');
		}
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('a chain with no single head leaves the request open', () => {
	const { out, chain } = chainWith((dir) => {
		writeMigration(dir, '0002_b', 'b', 'a', ['alter table posts add column x text']);
		writeMigration(dir, '0002_c', 'c', 'a', ['alter table posts add column y text']);
	});
	try {
		expect(chain.head).toBeNull();
		expect(decideWith(out, chain, NO_CHANGES, 'gone').outcome).toBe('unknown');
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test("the request's parent is no longer in the chain: left open", () => {
	const { out, chain } = chainWith();
	try {
		const decided = reconcileOpenRequest(request('lost'), NO_CHANGES, out, chain, {
			before: 'gone',
			after: 'gone',
		});
		expect(decided.outcome).toBe('unknown');
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

// The chain says the change was generated and committed; the database says whether it happened here.
test('the change on file in the chain: applied when its target is gone, left open when present', () => {
	const { out, chain } = chainWith((dir) => writeMigration(dir, '0002_b', 'b', 'a', DROP));
	try {
		expect(decideWith(out, chain, NO_CHANGES, 'gone')).toEqual({
			outcome: 'record',
			event: {
				type: 'applied',
				payload: { migration: '0002_b', outsideApproval: true, verified: true },
			},
		});
		// A directory from another database, or left behind by an interrupted boot — or a column
		// dropped and added back since. Nobody can tell from here, and the reason says both.
		const present = decideWith(out, chain, NO_CHANGES, 'present');
		expect(present.outcome).toBe('unknown');
		if (present.outcome === 'unknown') {
			expect(present.reason).toContain('0002_b');
			expect(present.reason).toContain('posts.body');
			expect(present.reason).toContain('never ran here');
			expect(present.reason).toContain('added back');
		}
		// Nothing to look for: say applied, and say it was not checked.
		expect(decideWith(out, chain, NO_CHANGES, 'undetermined')).toEqual({
			outcome: 'record',
			event: {
				type: 'applied',
				payload: { migration: '0002_b', outsideApproval: true, verified: false },
			},
		});
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

// The chain advanced without this exact change. The same drop may still have run as part of another
// migration, against another parent, or with a hand-edited file — the database settles it.
test('the chain moved on without the change: the database decides', () => {
	const other = ['alter table posts add column note text'];
	const { out, chain } = chainWith((dir) => writeMigration(dir, '0002_b', 'b', 'a', other));
	try {
		expect(decideWith(out, chain, NO_CHANGES, 'gone')).toEqual({
			outcome: 'record',
			event: { type: 'applied', payload: { outsideApproval: true, verified: true } },
		});
		// Still there, and no longer proposed: retracted.
		expect(decideWith(out, chain, NO_CHANGES, 'present')).toEqual({
			outcome: 'record',
			event: { type: 'withdrawn' },
		});
		// Still there, and proposed again against the new head: the new request takes over.
		const pendingAgain: ConvergeResult = {
			status: 'pending',
			statements: DROP,
			changeHash: 'h2',
			parentSnapshotId: 'b',
			findings: [],
			unclassified: [],
			decisions: [],
		};
		expect(decideWith(out, chain, pendingAgain, 'present')).toEqual({
			outcome: 'record',
			event: { type: 'superseded', payload: { supersededBy: 'h2' } },
		});
		// Nothing to look for and no exact match: nobody can say.
		expect(decideWith(out, chain, NO_CHANGES, 'undetermined').outcome).toBe('unknown');
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

// The chain advanced for an unrelated reason and this very boot then applied the drop: the reading
// from before says nobody else did it, the reading from after says this boot did.
test("this boot's own work is not attributed to somebody else", () => {
	const other = ['alter table posts add column note text'];
	const { out, chain } = chainWith((dir) => writeMigration(dir, '0002_b', 'b', 'a', other));
	try {
		const decided = reconcileOpenRequest(request(), APPLIED_OTHER, out, chain, {
			before: 'present',
			after: 'gone',
		});
		expect(decided).toEqual({
			outcome: 'record',
			event: { type: 'applied', payload: { reason: 'applied_with_other_changes' } },
		});
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('nothing ran in between: this boot decides', () => {
	const { out, chain } = chainWith();
	try {
		const pending = (changeHash: string): ConvergeResult => ({
			status: 'pending',
			statements: DROP,
			changeHash,
			parentSnapshotId: 'a',
			findings: [],
			unclassified: [],
			decisions: [],
		});

		expect(decideWith(out, chain, pending(HASH), 'present')).toEqual({ outcome: 'still_open' });
		expect(decideWith(out, chain, pending('other'), 'present')).toEqual({
			outcome: 'record',
			event: { type: 'superseded', payload: { supersededBy: 'other' } },
		});
		// The request's own change applied because there was nothing left to decide: applied, never
		// withdrawn.
		expect(decideWith(out, chain, APPLIED_SAME, 'gone')).toEqual({
			outcome: 'record',
			event: { type: 'applied', payload: { reason: 'nothing_to_decide' } },
		});
		// The drop went along with other changes in one migration: still applied.
		expect(decideWith(out, chain, APPLIED_OTHER, 'gone')).toEqual({
			outcome: 'record',
			event: { type: 'applied', payload: { reason: 'applied_with_other_changes' } },
		});
		// Something else applied and the target is still there: the drop was retracted.
		expect(decideWith(out, chain, APPLIED_OTHER, 'present')).toEqual({
			outcome: 'record',
			event: { type: 'withdrawn' },
		});
		expect(decideWith(out, chain, NO_CHANGES, 'present')).toEqual({
			outcome: 'record',
			event: { type: 'withdrawn' },
		});
		// Nothing to do, yet the target is gone: somebody removed it with no migration. The database
		// and the snapshot disagree, and neither `withdrawn` nor `applied` is true.
		const drift = decideWith(out, chain, NO_CHANGES, 'gone');
		expect(drift.outcome).toBe('unknown');
		if (drift.outcome === 'unknown') expect(drift.reason).toContain('disagree');
		// A failing boot resolves nothing.
		expect(decideWith(out, chain, { status: 'unsafe_change', findings: [] }, 'present')).toEqual({
			outcome: 'still_open',
		});
		expect(decideWith(out, chain, { status: 'error', code: 'internal' }, 'present')).toEqual({
			outcome: 'still_open',
		});
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

/** A request measured for the given findings. */
function asking(findings: unknown[]): OpenRequest {
	return {
		requestId: 'r',
		changeHash: 'h',
		createdAt: new Date(0),
		payload: { parentSnapshotId: 'a', findings },
	};
}

// The witness itself: what the database says about a request's targets.
matrixTest('checkTargets looks for what a request would change', async ({ db, dialect }) => {
	await db.raw('create table posts (id integer primary key, body text)');
	await db.raw('create table drafts (id integer primary key)');
	const query = (sql: string) => db.raw(sql);
	const dropDrafts = drop({ kind: 'drop_table', table: 'drafts' });

	expect(await checkTargets(query, dialect, asking([drop(DROP_BODY)]))).toBe('present');
	expect(await checkTargets(query, dialect, asking([dropDrafts]))).toBe('present');
	// An unclassified-only request drops nothing that can be looked for.
	expect(await checkTargets(query, dialect, asking([]))).toBe('undetermined');

	// A narrowing is checkable on Postgres, where length is declared and enforced; SQLite never
	// narrows, so it never asks.
	const narrowing = asking([
		drop({ kind: 'narrow_column', table: 'posts', column: 'body', maxLength: 3 }),
	]);
	expect(await checkTargets(query, dialect, narrowing)).toBe('undetermined');
	if (dialect === 'postgres') {
		await db.raw('alter table posts alter column body type varchar(10)');
		expect(await checkTargets(query, dialect, narrowing)).toBe('present');
		await db.raw('alter table posts alter column body type varchar(3)');
		expect(await checkTargets(query, dialect, narrowing)).toBe('gone');
	}

	await db.raw('alter table posts drop column body');
	await db.raw('drop table drafts');
	expect(await checkTargets(query, dialect, asking([drop(DROP_BODY)]))).toBe('gone');
	expect(await checkTargets(query, dialect, asking([dropDrafts]))).toBe('gone');
	// A rename on the way means "absent" could mean "moved": gone is never asserted.
	expect(
		await checkTargets(query, dialect, asking([drop(DROP_BODY)]), { renamedOnPath: true }),
	).toBe('undetermined');
	// Nor is it for a request that also carries something nothing can look for.
	const withRider: OpenRequest = {
		...asking([drop(DROP_BODY)]),
		payload: { parentSnapshotId: 'a', findings: [drop(DROP_BODY)], unclassified: [{}] },
	};
	expect(await checkTargets(query, dialect, withRider)).toBe('undetermined');
	// A missing table says nothing about a column: dropped, or renamed with the data kept.
	await db.raw('alter table posts rename to articles');
	expect(await checkTargets(query, dialect, asking([drop(DROP_BODY)]))).toBe('undetermined');
	// Any one target still present is enough to say present.
	await db.raw('alter table articles rename to posts');
	await db.raw('create table drafts (id integer primary key)');
	expect(await checkTargets(query, dialect, asking([drop(DROP_BODY), dropDrafts]))).toBe('present');
});
