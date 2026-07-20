import { expect, test } from '../../harness/index.ts';
import { decodeEnvelope } from './index.ts';

// These specs are pure JSON → JSON (no DB, runtime-independent). The inputs mirror the real
// drizzle-kit 1.0-rc envelopes captured in docs/research/drizzle-kit-rc-1.0-sdk.md.

test('decodes an ok generate envelope with a migration path', () => {
	const result = decodeEnvelope({
		status: 'ok',
		dialect: 'sqlite',
		migration_path: 'drizzle/0001_x/migration.sql',
	});
	expect(result).toEqual({
		status: 'ok',
		statements: [],
		migrationPath: 'drizzle/0001_x/migration.sql',
	});
});

test('decodes an ok export envelope carrying statements', () => {
	const result = decodeEnvelope({
		status: 'ok',
		dialect: 'postgresql',
		statements: ['ALTER TABLE "users" DROP COLUMN "nickname";'],
		warnings: [],
	});
	expect(result).toEqual({
		status: 'ok',
		statements: ['ALTER TABLE "users" DROP COLUMN "nickname";'],
	});
});

test('decodes no_changes', () => {
	expect(decodeEnvelope({ status: 'no_changes', dialect: 'sqlite' })).toEqual({
		status: 'no_changes',
	});
});

test('decodes a confirm_data_loss (non_empty) decision', () => {
	const result = decodeEnvelope({
		status: 'missing_hints',
		unresolved: [
			{
				type: 'confirm_data_loss',
				kind: 'column',
				entity: ['public', 'users', 'nickname'],
				reason: 'non_empty',
			},
		],
	});
	expect(result).toEqual({
		status: 'needs_decision',
		decisions: [
			{
				type: 'confirm_data_loss',
				entityKind: 'column',
				entity: ['public', 'users', 'nickname'],
				reason: 'non_empty',
			},
		],
	});
});

test('decodes a rename_or_create decision', () => {
	const result = decodeEnvelope({
		status: 'missing_hints',
		unresolved: [
			{ type: 'rename_or_create', kind: 'column', entity: ['public', 'users', 'handle'] },
		],
	});
	expect(result).toEqual({
		status: 'needs_decision',
		decisions: [
			{ type: 'rename_or_create', entityKind: 'column', entity: ['public', 'users', 'handle'] },
		],
	});
});

test('decodes a type_change decision with from/to details', () => {
	const result = decodeEnvelope({
		status: 'missing_hints',
		unresolved: [
			{
				type: 'confirm_data_loss',
				kind: 'column',
				entity: ['public', 't', 'c'],
				reason: 'type_change',
				reason_details: { from: 'text', to: 'integer' },
			},
		],
	});
	expect(result).toEqual({
		status: 'needs_decision',
		decisions: [
			{
				type: 'confirm_data_loss',
				entityKind: 'column',
				entity: ['public', 't', 'c'],
				reason: 'type_change',
				reasonDetails: { from: 'text', to: 'integer' },
			},
		],
	});
});

test('maps a known error code and preserves the raw code', () => {
	const result = decodeEnvelope({
		status: 'error',
		error: { code: 'query_error', sql: 'ALTER TABLE ...', params: [] },
	});
	expect(result).toEqual({ status: 'error', code: 'query_error', rawCode: 'query_error' });
});

test('maps a config error code and keeps the message as detail', () => {
	const result = decodeEnvelope({
		status: 'error',
		error: { code: 'config_validation_error', message: 'bad config' },
	});
	expect(result).toEqual({
		status: 'error',
		code: 'config_invalid',
		rawCode: 'config_validation_error',
		detail: 'bad config',
	});
});

test('falls back to unknown for an unmapped error code', () => {
	const result = decodeEnvelope({ status: 'error', error: { code: 'some_future_error' } });
	expect(result).toEqual({ status: 'error', code: 'unknown', rawCode: 'some_future_error' });
});

test('returns an error result for garbage input', () => {
	for (const junk of [null, undefined, 'nope', 42, [], {}]) {
		const result = decodeEnvelope(junk);
		expect(result.status).toBe('error');
		if (result.status === 'error') expect(result.code).toBe('unknown');
	}
});

test('skips unparseable decisions but keeps the valid ones', () => {
	const result = decodeEnvelope({
		status: 'missing_hints',
		unresolved: [
			{ type: 'confirm_data_loss', kind: 'table', entity: ['public', 't'], reason: 'non_empty' },
			{ garbage: true },
			{ type: 'unknown_type', kind: 'x', entity: [] },
		],
	});
	expect(result.status).toBe('needs_decision');
	if (result.status === 'needs_decision') {
		expect(result.decisions).toHaveLength(1);
		expect(result.decisions[0]?.type).toBe('confirm_data_loss');
	}
});
