import { describe, it, expect } from 'bun:test';

import { operationToResponse } from './utils';

describe('operationToResponse', () => {
	it('returns { sql } for a successful result', () => {
		const response = operationToResponse({
			success: true,
			sql: 'CREATE TABLE "articles" ("id" UUID PRIMARY KEY);',
		});

		expect(response).toEqual({
			sql: 'CREATE TABLE "articles" ("id" UUID PRIMARY KEY);',
		});
	});

	it('returns { code, error } for a failed result', () => {
		const response = operationToResponse({
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection: 'articles' },
		});

		expect(response).toEqual({
			code: 'COLLECTION_NOT_FOUND',
			error: { collection: 'articles' },
		});
	});
});
