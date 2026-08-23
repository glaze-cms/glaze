import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveConfig } from '#config';
import { expect, test } from '#harness';

import { loadEntities } from '../loader.ts';
import { describeContentModel } from './resolver.ts';

import type { Dialect } from '#dialect';
import type { Entity } from '../types.ts';
import type { EntityDescriptor, FieldNode } from './types.ts';

/** Temp schema fixtures under `node_modules` (so `drizzle-orm/*` resolves), emitted `.mjs`. */
const TEMP_FIXTURE_PREFIX = join(
	import.meta.dirname,
	'..',
	'..',
	'..',
	'node_modules',
	'glaze-content-descriptor-fixture-',
);

/** The dialects the descriptor must produce identical output for. */
const DIALECTS: readonly Dialect[] = ['postgres', 'sqlite'];

/**
 * Emits a schema module and loads its entities. Written per dialect so one spec proves the
 * descriptor normalises what the two dialects express differently.
 *
 * @param dialect - The dialect to emit for.
 * @param body - The module source, minus the dialect-specific import line.
 * @returns The loaded entities.
 */
async function loadFixture(dialect: Dialect, body: string): Promise<Entity[]> {
	const dir = mkdtempSync(TEMP_FIXTURE_PREFIX);
	try {
		const core = dialect === 'postgres' ? 'pg-core' : 'sqlite-core';
		const path = join(dir, 'schema.mjs');
		writeFileSync(path, `import * as d from 'drizzle-orm/${core}';\n${body}\n`);
		return await loadEntities(resolveConfig({ dialect, connection: 'unused', schema: path }));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Finds an entity in a descriptor by name.
 *
 * @param entities - The described entities.
 * @param name - The entity to find.
 * @returns The descriptor, or `undefined`.
 */
function findEntity(
	entities: readonly EntityDescriptor[],
	name: string,
): EntityDescriptor | undefined {
	return entities.find((entity) => entity.name === name);
}

/**
 * Finds a field on an entity by name, asserting it is a leaf field node.
 *
 * @param entity - The entity descriptor.
 * @param name - The field to find.
 * @returns The field node, or `undefined`.
 */
function findField(entity: EntityDescriptor, name: string): FieldNode | undefined {
	const field = entity.fields.find((candidate) => candidate.name === name);
	return field?.kind === 'field' ? field : undefined;
}

/**
 * A length-bounded text column for the dialect. Postgres ignores a `length` on `text` — only `varchar`
 * carries one — so a fixture that wants a bounded column must pick the right helper per dialect.
 *
 * @param dialect - The dialect to emit for.
 * @param name - The column name.
 * @param length - The bound.
 * @returns The column expression source.
 */
function boundedText(dialect: Dialect, name: string, length: number): string {
	const helper = dialect === 'postgres' ? 'varchar' : 'text';
	return `d.${helper}('${name}', { length: ${length} })`;
}

/** A `posts` table exercising every inferable column shape, written per dialect. */
function postsFixture(dialect: Dialect): string {
	const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
	const columns =
		dialect === 'postgres'
			? `id: d.serial('id').primaryKey(),
				title: d.varchar('title', { length: 200 }).notNull(),
				body: d.text('body'),
				summary: d.varchar('summary', { length: 2000 }),
				price: d.numeric('price'),
				views: d.integer('views').default(0),
				published: d.boolean('published').default(false),
				createdAt: d.timestamp('created_at', { withTimezone: true }),
				state: d.text('state', { enum: ['draft', 'live'] }),
				payload: d.jsonb('payload')`
			: `id: d.integer('id').primaryKey(),
				title: ${boundedText(dialect, 'title', 200)}.notNull(),
				body: d.text('body'),
				summary: d.text('summary', { length: 2000 }),
				price: d.real('price'),
				views: d.integer('views').default(0),
				published: d.integer('published', { mode: 'boolean' }).default(false),
				createdAt: d.integer('created_at', { mode: 'timestamp' }),
				state: d.text('state', { enum: ['draft', 'live'] }),
				payload: d.blob('payload', { mode: 'json' })`;
	return `export const posts = d.${table}('posts', { ${columns} });`;
}

for (const dialect of DIALECTS) {
	test(`infers semantic field types from column facts [${dialect}]`, async () => {
		const entities = await loadFixture(dialect, postsFixture(dialect));
		const posts = findEntity(describeContentModel(entities).entities, 'posts');
		if (!posts) throw new Error('expected a posts entity');

		// Text defaults to a single line; only a generous bound implies prose. SQLite carries no length
		// at all, so defaulting the other way would give every title and slug a textarea.
		expect(findField(posts, 'title')?.fieldType).toBe('shortText');
		expect(findField(posts, 'body')?.fieldType).toBe('shortText');
		expect(findField(posts, 'summary')?.fieldType).toBe('longText');
		expect(findField(posts, 'views')?.fieldType).toBe('number');
		expect(findField(posts, 'published')?.fieldType).toBe('boolean');
		expect(findField(posts, 'createdAt')?.fieldType).toBe('datetime');
		expect(findField(posts, 'state')?.fieldType).toBe('select');
		// Rich text and raw JSON are indistinguishable in DDL, so neither is guessed.
		expect(findField(posts, 'payload')?.fieldType).toBe('unknown');
	});

	test(`treats a decimal column as a number despite its carried type [${dialect}]`, async () => {
		const entities = await loadFixture(dialect, postsFixture(dialect));
		const posts = findEntity(describeContentModel(entities).entities, 'posts');
		if (!posts) throw new Error('expected a posts entity');

		// Postgres carries `numeric` as a string to keep precision; an editor still needs a number input.
		expect(findField(posts, 'price')?.fieldType).toBe('number');
		expect(findField(posts, 'price')?.config.decimalAllowed).toBe(true);
		expect(findField(posts, 'views')?.config.decimalAllowed).toBe(false);
	});

	test(`derives structural config from the column [${dialect}]`, async () => {
		const entities = await loadFixture(dialect, postsFixture(dialect));
		const posts = findEntity(describeContentModel(entities).entities, 'posts');
		if (!posts) throw new Error('expected a posts entity');

		expect(findField(posts, 'title')?.config.required).toBe(true);
		expect(findField(posts, 'body')?.config.required).toBe(false);
		expect(findField(posts, 'title')?.config.maxLength).toBe(200);
		expect(findField(posts, 'body')?.config.maxLength).toBeNull();
		expect(findField(posts, 'state')?.config.options.length).toBe(2);
		expect(findField(posts, 'state')?.config.options[0]?.value).toBe('draft');
	});

	test(`marks presentation keys as inferred, never invented [${dialect}]`, async () => {
		const entities = await loadFixture(dialect, postsFixture(dialect));
		const posts = findEntity(describeContentModel(entities).entities, 'posts');
		if (!posts) throw new Error('expected a posts entity');

		expect(findField(posts, 'createdAt')?.label).toBe('Created at');
		expect(findField(posts, 'title')?.fieldTypeSource).toBe('inferred');
		// No presentation storage exists yet, so a description can only be absent.
		expect(findField(posts, 'title')?.description).toBeNull();
		// The first single-line text field identifies an entry until an override names one.
		expect(posts.displayField).toBe('title');
	});

	test(`reports which routes an entity actually serves [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const column = `d.integer`;
		const entities = await loadFixture(
			dialect,
			`export const events = d.${table}('events', { at: ${column}('at'), note: d.text('note') });`,
		);
		const events = findEntity(describeContentModel(entities).entities, 'events');
		if (!events) throw new Error('expected an events entity');

		// Without a single-column key there is no way to address one row, so only list + create exist.
		expect(events.primaryKey).toBeNull();
		expect(events.capabilities.create).toBe(true);
		expect(events.capabilities.byId).toBe(false);
		expect(events.capabilities.update).toBe(false);
		expect(events.capabilities.delete).toBe(false);
		expect(events.defaultSort).toBeNull();
	});

	test(`infers a foreign key as a relation, and one into media as media [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const entities = await loadFixture(
			dialect,
			`export const authors = d.${table}('authors', { id: ${id}, name: ${boundedText(dialect, 'name', 80)} });
			export const media = d.${table}('media', { id: ${id}, url: ${boundedText(dialect, 'url', 300)} });
			export const posts = d.${table}('posts', {
				id: ${id},
				title: ${boundedText(dialect, 'title', 200)},
				authorId: d.integer('author_id').references(() => authors.id),
				coverId: d.integer('cover_id').references(() => media.id),
			});`,
		);
		const posts = findEntity(describeContentModel(entities).entities, 'posts');
		if (!posts) throw new Error('expected a posts entity');

		expect(findField(posts, 'authorId')?.fieldType).toBe('relation');
		expect(findField(posts, 'authorId')?.relation?.entity).toBe('authors');
		expect(findField(posts, 'authorId')?.relation?.cardinality).toBe('one');
		// A foreign key into the media library gets the upload control rather than a row picker.
		expect(findField(posts, 'coverId')?.fieldType).toBe('media');
		// A relation column never identifies an entry, however text-like its target is.
		expect(posts.displayField).toBe('title');
	});

	test(`consumes a pure junction into relations on both sides [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const entities = await loadFixture(
			dialect,
			`export const posts = d.${table}('posts', { id: ${id}, title: ${boundedText(dialect, 'title', 200)} });
			export const tags = d.${table}('tags', { id: ${id}, name: ${boundedText(dialect, 'name', 80)} });
			export const postTags = d.${table}('post_tags', {
				postId: d.integer('post_id').references(() => posts.id).notNull(),
				tagId: d.integer('tag_id').references(() => tags.id).notNull(),
			}, (t) => [d.primaryKey({ columns: [t.postId, t.tagId] })]);`,
		);
		const described = describeContentModel(entities).entities;

		// The junction is storage, not a content type — an editor never sees "Post Tags".
		expect(findEntity(described, 'post_tags') === undefined).toBe(true);

		const posts = findEntity(described, 'posts');
		const tags = findEntity(described, 'tags');
		if (!posts || !tags) throw new Error('expected posts and tags entities');

		expect(findField(posts, 'tags')?.fieldType).toBe('relation');
		expect(findField(posts, 'tags')?.relation?.cardinality).toBe('many');
		// Writing it means inserting junction rows, and that path does not exist yet.
		expect(findField(posts, 'tags')?.relation?.writable).toBe(false);
		expect(findField(tags, 'posts')?.relation?.entity).toBe('posts');
	});

	test(`keeps a junction that carries content as an entity [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const entities = await loadFixture(
			dialect,
			`export const posts = d.${table}('posts', { id: ${id}, title: ${boundedText(dialect, 'title', 200)} });
			export const authors = d.${table}('authors', { id: ${id}, name: ${boundedText(dialect, 'name', 80)} });
			export const postAuthors = d.${table}('post_authors', {
				postId: d.integer('post_id').references(() => posts.id).notNull(),
				authorId: d.integer('author_id').references(() => authors.id).notNull(),
				role: ${boundedText(dialect, 'role', 40)},
			}, (t) => [d.primaryKey({ columns: [t.postId, t.authorId] })]);`,
		);
		const described = describeContentModel(entities).entities;

		// `role` is content a reader may see, so consuming the table would hide real data.
		const junction = findEntity(described, 'post_authors');
		if (!junction) throw new Error('expected post_authors to remain an entity');
		expect(findField(junction, 'role')?.fieldType).toBe('shortText');
		expect(findEntity(described, 'posts')?.fields.some((f) => f.name === 'authors')).toBe(false);
	});

	test(`keeps a composite-key table whose key is not all foreign keys [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const entities = await loadFixture(
			dialect,
			`export const posts = d.${table}('posts', { id: ${id}, title: ${boundedText(dialect, 'title', 200)} });
			export const revisions = d.${table}('revisions', {
				postId: d.integer('post_id').references(() => posts.id).notNull(),
				version: d.integer('version').notNull(),
			}, (t) => [d.primaryKey({ columns: [t.postId, t.version] })]);`,
		);
		const described = describeContentModel(entities).entities;

		// `version` is not a foreign key, so this addresses real entities rather than linking two.
		expect(findEntity(described, 'revisions') !== undefined).toBe(true);
	});
}

for (const dialect of DIALECTS) {
	test(`keeps a junction whose extra column is a defaulted date [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const startsAt =
			dialect === 'postgres'
				? `d.timestamp('starts_at').defaultNow()`
				: `d.integer('starts_at', { mode: 'timestamp' }).default(new Date(0))`;
		const entities = await loadFixture(
			dialect,
			`export const users = d.${table}('users', { id: ${id}, name: ${boundedText(dialect, 'name', 80)} });
			export const plans = d.${table}('plans', { id: ${id}, name: ${boundedText(dialect, 'name', 80)} });
			export const subscriptions = d.${table}('subscriptions', {
				userId: d.integer('user_id').references(() => users.id).notNull(),
				planId: d.integer('plan_id').references(() => plans.id).notNull(),
				startsAt: ${startsAt},
			}, (t) => [d.primaryKey({ columns: [t.userId, t.planId] })]);`,
		);
		const described = describeContentModel(entities).entities;

		// `starts_at` is the subscription period — content an editor owns. Consuming the table would
		// remove it from the Admin UI with no error and no log, which is worse than sidebar noise.
		const subs = findEntity(described, 'subscriptions');
		if (!subs) throw new Error('expected subscriptions to remain an entity');
		expect(findField(subs, 'startsAt')?.fieldType).toBe('datetime');
	});

	test(`gives a self-referential junction two distinct field names [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const entities = await loadFixture(
			dialect,
			`export const posts = d.${table}('posts', { id: ${id}, title: ${boundedText(dialect, 'title', 80)} });
			export const related = d.${table}('post_related', {
				postId: d.integer('post_id').references(() => posts.id).notNull(),
				otherId: d.integer('other_id').references(() => posts.id).notNull(),
			}, (t) => [d.primaryKey({ columns: [t.postId, t.otherId] })]);`,
		);
		const posts = findEntity(describeContentModel(entities).entities, 'posts');
		if (!posts) throw new Error('expected a posts entity');

		// Duplicated names silently drop one another in any consumer keyed by field name.
		const names = posts.fields.map((field) => field.name);
		expect(names.length).toBe(new Set(names).size);
	});

	test(`does not let a derived relation shadow a real column [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const entities = await loadFixture(
			dialect,
			`export const posts = d.${table}('posts', {
				id: ${id},
				title: ${boundedText(dialect, 'title', 80)},
				tags: ${boundedText(dialect, 'tags', 100)},
			});
			export const tags = d.${table}('tags', { id: ${id}, name: ${boundedText(dialect, 'name', 80)} });
			export const postTags = d.${table}('post_tags', {
				postId: d.integer('post_id').references(() => posts.id).notNull(),
				tagId: d.integer('tag_id').references(() => tags.id).notNull(),
			}, (t) => [d.primaryKey({ columns: [t.postId, t.tagId] })]);`,
		);
		const posts = findEntity(describeContentModel(entities).entities, 'posts');
		if (!posts) throw new Error('expected a posts entity');

		const names = posts.fields.map((field) => field.name);
		expect(names.length).toBe(new Set(names).size);
		// The real column keeps its name; the relation is the one that yields.
		expect(findField(posts, 'tags')?.fieldType).toBe('shortText');
	});

	test(`names a relation target by its property, not its database column [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const key =
			dialect === 'postgres'
				? `d.serial('author_key').primaryKey()`
				: `d.integer('author_key').primaryKey()`;
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const entities = await loadFixture(
			dialect,
			`export const authors = d.${table}('authors', { authorKey: ${key}, name: ${boundedText(dialect, 'name', 80)} });
			export const articles = d.${table}('articles', {
				id: ${id},
				authorId: d.integer('author_id').references(() => authors.authorKey),
			});`,
		);
		const articles = findEntity(describeContentModel(entities).entities, 'articles');
		if (!articles) throw new Error('expected an articles entity');

		// Every other name in the descriptor is a property name, and the list endpoint resolves filters
		// by property — emitting `author_key` makes the relation picker's own query a 422.
		expect(findField(articles, 'authorId')?.relation?.column).toBe('authorKey');
	});

	test(`reports a computed default without leaking the ORM's internals [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const computed =
			dialect === 'postgres'
				? `d.timestamp('created_at').defaultNow()`
				: `d.integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())`;
		const entities = await loadFixture(
			dialect,
			`export const posts = d.${table}('posts', {
				id: ${id},
				views: d.integer('views').default(7),
				createdAt: ${computed},
			});`,
		);
		const posts = findEntity(describeContentModel(entities).entities, 'posts');
		if (!posts) throw new Error('expected a posts entity');

		// A literal default is reported as-is.
		expect(findField(posts, 'views')?.config.defaultValue).toBe(7);
		// A computed one has no serialisable literal, but must still be distinguishable from "no default"
		// — otherwise a generated key reads as required-with-nothing-to-fill-it.
		expect(findField(posts, 'createdAt')?.config.defaultValue).toBeNull();
		expect(findField(posts, 'createdAt')?.config.hasDefault).toBe(true);
		expect(findField(posts, 'id')?.config.hasDefault).toBe(true);
	});

	test(`never offers a secret as the display field [${dialect}]`, async () => {
		const table = dialect === 'postgres' ? 'pgTable' : 'sqliteTable';
		const id =
			dialect === 'postgres' ? `d.serial('id').primaryKey()` : `d.integer('id').primaryKey()`;
		const entities = await loadFixture(
			dialect,
			`export const users = d.${table}('users', {
				id: ${id},
				passwordHash: ${boundedText(dialect, 'password_hash', 120)},
				email: ${boundedText(dialect, 'email', 120)},
			});`,
		);
		const users = findEntity(describeContentModel(entities).entities, 'users');
		if (!users) throw new Error('expected a users entity');

		// displayField feeds the list's first column AND every relation dropdown, so a hash chosen here
		// scatters credentials across the Admin UI. Declaration order would otherwise pick it.
		expect(users.displayField).toBe('email');
	});
}

// Postgres-only: SQLite has no UUID type, so an opaque identifier there is genuinely indistinguishable
// from ordinary text and no inference can exclude it.
test('skips an opaque uuid when choosing a display field', async () => {
	const entities = await loadFixture(
		'postgres',
		`export const things = d.pgTable('things', {
			id: d.serial('id').primaryKey(),
			externalId: d.uuid('external_id'),
			label: d.varchar('label', { length: 80 }),
		});`,
	);
	const things = findEntity(describeContentModel(entities).entities, 'things');
	if (!things) throw new Error('expected a things entity');

	expect(things.displayField).toBe('label');
});

test('treats a string-mode timestamp as a date, not text', async () => {
	const entities = await loadFixture(
		'postgres',
		`export const posts = d.pgTable('posts', {
			id: d.serial('id').primaryKey(),
			publishedAt: d.timestamp('published_at', { mode: 'string' }),
			price: d.numeric('price', { mode: 'number' }),
		});`,
	);
	const posts = findEntity(describeContentModel(entities).entities, 'posts');
	if (!posts) throw new Error('expected a posts entity');

	// `mode: 'string'` is the standard way to dodge JS Date timezone drift; it must still be a date.
	expect(findField(posts, 'publishedAt')?.fieldType).toBe('datetime');
	// The mode changes how Drizzle carries the value, not what the column stores.
	expect(findField(posts, 'price')?.fieldType).toBe('number');
	expect(findField(posts, 'price')?.config.decimalAllowed).toBe(true);
});
