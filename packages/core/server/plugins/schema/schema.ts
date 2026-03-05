import { t } from 'elysia';

import {
	createCollection,
	renameCollection,
	dropCollection,
	addField,
	renameField,
	dropField,
	alterField,
	runIntrospectionInBackground,
} from '@glaze/convergence';
import { operationToResponse } from '../../../lib/utils/index';

import type { GlazeInternalConfig, GlazeEnv } from '@glaze/config';
import { glazeHook, type GlazeApp } from '../../types';

const FIELD_TYPE = t.Union([
	t.Literal('text'),
	t.Literal('integer'),
	t.Literal('boolean'),
	t.Literal('timestamp'),
	t.Literal('uuid'),
	t.Literal('jsonb'),
	t.Literal('numeric'),
]);

const EXPR_DEFAULT = t.Object({
	expr: t.Union([
		t.Literal('NOW()'),
		t.Literal('CURRENT_TIMESTAMP'),
		t.Literal('gen_random_uuid()'),
	]),
});

const FIELD_DEFAULT = t.Union([
	t.String(),
	t.Number(),
	t.Boolean(),
	t.Null(),
	EXPR_DEFAULT,
]);

const FIELD_DEF = t.Object({
	name: t.String(),
	type: FIELD_TYPE,
	nullable: t.Optional(t.Boolean()),
	default: t.Optional(FIELD_DEFAULT),
	primaryKey: t.Optional(t.Boolean()),
	unique: t.Optional(t.Boolean()),
});

export const schemaPlugin =
	(config: GlazeInternalConfig, env: GlazeEnv) => (app: GlazeApp) => {
		const connectionString = env.GLAZE_DATABASE_URL;
		const schemaOutDir =
			config.sync.workflow === 'solo'
				? (config.sync.solo?.schemaOutDir ?? './schema')
				: './schema';

		const { db, logger } = app.decorator;

		return app.group('/schema', (group) =>
			group
				// ─── Collections ──────────────────────────────────────────────────

				.post(
					'/collections',
					async ({ set, body }) => {
						const result = await createCollection(db, body);
						if (!result.success) {
							set.status = 422;
							return operationToResponse(result);
						}
						runIntrospectionInBackground({
							connectionString,
							schemaOutDir,
							logger,
						});
						return operationToResponse(result);
					},
					glazeHook({
						requireRole: 'editor',
						body: t.Object({
							name: t.String(),
							fields: t.Array(FIELD_DEF),
						}),
					}),
				)

				.patch(
					'/collections/:collection',
					async ({ set, params, body }) => {
						const result = await renameCollection(db, {
							collection: params.collection,
							newName: body.newName,
						});
						if (!result.success) {
							set.status = 422;
							return operationToResponse(result);
						}
						runIntrospectionInBackground({
							connectionString,
							schemaOutDir,
							logger,
						});
						return operationToResponse(result);
					},
					glazeHook({
						requireRole: 'editor',
						body: t.Object({ newName: t.String() }),
					}),
				)

				.delete(
					'/collections/:collection',
					async ({ set, params }) => {
						const result = await dropCollection(db, {
							collection: params.collection,
						});
						if (!result.success) {
							set.status = 422;
							return operationToResponse(result);
						}
						runIntrospectionInBackground({
							connectionString,
							schemaOutDir,
							logger,
						});
						return operationToResponse(result);
					},
					glazeHook({ requireRole: 'editor' }),
				)

				// ─── Fields ───────────────────────────────────────────────────────

				.post(
					'/collections/:collection/fields',
					async ({ set, params, body }) => {
						const result = await addField(db, {
							collection: params.collection,
							field: body,
						});
						if (!result.success) {
							set.status = 422;
							return operationToResponse(result);
						}
						runIntrospectionInBackground({
							connectionString,
							schemaOutDir,
							logger,
						});
						return operationToResponse(result);
					},
					glazeHook({ requireRole: 'editor', body: FIELD_DEF }),
				)

				.patch(
					'/collections/:collection/fields/:field',
					async ({ set, params, body }) => {
						if ('newName' in body && body.newName) {
							const result = await renameField(db, {
								collection: params.collection,
								field: params.field,
								newName: body.newName,
							});
							if (!result.success) {
								set.status = 422;
								return operationToResponse(result);
							}
							runIntrospectionInBackground({
								connectionString,
								schemaOutDir,
								logger,
							});
							return operationToResponse(result);
						}

						const result = await alterField(db, {
							collection: params.collection,
							field: params.field,
							changes: body,
						});
						if (!result.success) {
							set.status = 422;
							return operationToResponse(result);
						}
						runIntrospectionInBackground({
							connectionString,
							schemaOutDir,
							logger,
						});
						return operationToResponse(result);
					},

					glazeHook({
						requireRole: 'editor',
						body: t.Object({
							newName: t.Optional(t.String()),
							nullable: t.Optional(t.Boolean()),
							default: t.Optional(t.Union([t.Literal('drop'), FIELD_DEFAULT])),
						}),
					}),
				)

				.delete(
					'/collections/:collection/fields/:field',
					async ({ set, params }) => {
						const result = await dropField(db, {
							collection: params.collection,
							field: params.field,
						});
						if (!result.success) {
							set.status = 422;
							return operationToResponse(result);
						}
						runIntrospectionInBackground({
							connectionString,
							schemaOutDir,
							logger,
						});
						return operationToResponse(result);
					},
					glazeHook({ requireRole: 'editor' }),
				),
		);
	};
