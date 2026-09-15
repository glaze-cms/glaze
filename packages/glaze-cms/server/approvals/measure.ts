/**
 * Measuring a request again, and fingerprinting what the person is shown.
 *
 * "1,204 rows hold data" is a live count that legitimately moves between filing and approval. So the
 * list re-measures before it shows anything, and an approval carries the fingerprint of the counts
 * the person saw; the server measures once more and refuses when they differ. Somebody who approved
 * "this drops 12 rows" did not approve "this drops 40,000".
 */

import { createHash } from 'node:crypto';

import { detectDataLoss } from '#convergence';

import { changesOf } from './requests.ts';

import type { DataLossFinding, QueryExecutor } from '#convergence';
import type { Dialect } from '#dialect';
import type { OpenRequest } from './store.ts';

/** What the database says about a request right now, and the fingerprint of that. */
export interface Measurement {
	readonly findings: readonly DataLossFinding[];
	readonly findingsHash: string;
}

/**
 * The fingerprint of a set of findings: what they measure and what they found, in a fixed order, so
 * two measurements agree exactly when a person would have been shown the same thing.
 *
 * @param findings - The findings.
 * @returns The hash, lowercase hex.
 */
export function hashFindings(findings: readonly DataLossFinding[]): string {
	const lines = findings
		.map((finding) =>
			JSON.stringify([
				finding.change.kind,
				finding.change.schema ?? '',
				finding.change.table,
				'column' in finding.change ? finding.change.column : '',
				finding.code,
				finding.affectedRows,
			]),
		)
		.toSorted();
	return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Measures a request's changes against the live database, as the filing boot did.
 *
 * @param query - The dialect seam's raw executor.
 * @param dialect - The dialect.
 * @param open - The open request.
 * @returns The live findings and their fingerprint.
 */
export async function measureRequest(
	query: QueryExecutor,
	dialect: Dialect,
	open: OpenRequest,
): Promise<Measurement> {
	const findings = await detectDataLoss(query, dialect, changesOf(open));
	return { findings, findingsHash: hashFindings(findings) };
}
