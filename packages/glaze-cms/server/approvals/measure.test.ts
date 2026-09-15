import { expect, matrixTest, test } from '#harness';

import { hashFindings, measureRequest } from './measure.ts';

import type { DataLossFinding } from '#convergence';
import type { OpenRequest } from './store.ts';

const DROP_BODY = { kind: 'drop_column', table: 'posts', column: 'body' } as const;
const DROP_DRAFTS = { kind: 'drop_table', table: 'drafts' } as const;

/** A finding with a count. */
function found(change: DataLossFinding['change'], affectedRows: number | null): DataLossFinding {
	return {
		change,
		code: affectedRows === null ? 'could_not_verify' : 'column_has_data',
		affectedRows,
	};
}

test('the findings fingerprint depends on what was measured and what was found, not on order', () => {
	const a = hashFindings([found(DROP_BODY, 1), found(DROP_DRAFTS, 3)]);
	const b = hashFindings([found(DROP_DRAFTS, 3), found(DROP_BODY, 1)]);
	expect(a).toBe(b);
	expect(a).toHaveLength(64);

	// A different count is a different thing to agree to.
	expect(hashFindings([found(DROP_BODY, 2)]) === hashFindings([found(DROP_BODY, 1)])).toBe(false);
	// So is a different target, or a measurement that could not be taken.
	expect(hashFindings([found(DROP_DRAFTS, 1)]) === hashFindings([found(DROP_BODY, 1)])).toBe(false);
	expect(hashFindings([found(DROP_BODY, null)]) === hashFindings([found(DROP_BODY, 1)])).toBe(
		false,
	);
	expect(hashFindings([])).toBe(hashFindings([]));
});

matrixTest(
	'measureRequest measures a request against the live database again',
	async ({ db, dialect }) => {
		await db.raw('create table posts (id integer primary key, body text)');
		await db.raw("insert into posts (id, body) values (1, 'a'), (2, 'b'), (3, null)");
		const query = (sql: string) => db.raw(sql);
		const open: OpenRequest = {
			requestId: 'r',
			changeHash: 'h',
			createdAt: new Date(0),
			payload: { findings: [found(DROP_BODY, 1)] },
		};

		const measured = await measureRequest(query, dialect, open);
		expect(measured.findings.map((finding) => [finding.code, finding.affectedRows])).toEqual([
			['column_has_data', 2],
		]);
		expect(measured.findingsHash).toBe(hashFindings(measured.findings));

		// The column gone: the measurement says it cannot verify, which is not what anybody was shown.
		await db.raw('alter table posts drop column body');
		const gone = await measureRequest(query, dialect, open);
		expect(gone.findings.map((finding) => finding.code)).toEqual(['could_not_verify']);
		expect(gone.findingsHash === measured.findingsHash).toBe(false);
	},
);
