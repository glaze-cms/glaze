/**
 * Infers a field's semantic type and structural configuration from its Drizzle column.
 *
 * This is the **only** place column facts become a {@link FieldType}, and it lives on the server on
 * purpose: the same logical field is a different column per dialect (`boolean` vs
 * `integer({ mode: 'boolean' })`, `timestamp` vs `integer({ mode: 'timestamp' })`, `pgEnum` vs
 * `text({ enum })`), so inferring in a client would put a dialect branch outside the seam and beyond
 * the matrix harness. Drizzle's `dataType` is already normalised across dialects, so this reads that
 * first and only consults `columnType` where `dataType` is misleading — see {@link isDecimalColumn}.
 *
 * Inference covers what DDL can prove. Everything it cannot — rich text versus arbitrary JSON, a
 * colour versus a short string, an editor-facing label — resolves to a safe fallback here and is
 * corrected later by stored presentation metadata.
 */

import type { Entity, ColumnReference } from '../types.ts';
import type { FieldConfig, FieldOption, FieldType } from './types.ts';
import type { Column } from 'drizzle-orm';

/**
 * The entity a `media` field points at. A foreign key into it infers as `media` rather than a
 * plain `relation`, so the editor gets the upload/browse control. A convention until Glaze owns a real
 * media library, at which point this becomes that table's identity.
 */
const MEDIA_ENTITY = 'media';

/**
 * Data-type constraints that mean the column accepts fractional values. Reading the constraint rather
 * than the category is what makes this dialect-agnostic: Postgres `numeric` is carried as
 * `string numeric` (a string, to preserve precision) while SQLite `real` is `number double`, so the
 * category alone would call a price column text on one dialect and a number on the other.
 */
const DECIMAL_CONSTRAINTS = new Set(['numeric', 'decimal', 'double', 'float']);

/**
 * Constraints marking a column as a point in time, whatever it is physically stored as. All three are
 * needed: `timestamp()` carries `object date`, but `timestamp({ mode: 'string' })` — the standard way to
 * avoid JS `Date` timezone drift — carries `string timestamp`, and `time()` carries `string time`.
 * Matching only `date` gave a correctness-conscious schema a plain text input for its dates.
 */
const DATE_CONSTRAINTS = new Set(['date', 'timestamp', 'time']);

/**
 * Column-type markers for columns that accept fractional values but whose data type does NOT say so.
 * `numeric()` reports `string numeric`, but `numeric({ mode: 'number' })` reports a bare `number` and
 * `numeric({ mode: 'bigint' })` reports `bigint int64` — the mode changes how Drizzle carries the value,
 * not what the column stores. The column type is the only place the truth survives, and it is matched
 * by substring because the mode is appended to it (`PgNumericNumber`, `PgNumericBigInt`).
 */
const DECIMAL_COLUMN_TYPES = ['Numeric', 'Decimal', 'Real', 'Double', 'Float'];

/**
 * Field types that never identify an entry to a human, however text-shaped they are. A UUID or an IP
 * address is opaque, and a password hash must never reach a list view or a relation dropdown.
 */
const OPAQUE_CONSTRAINTS = new Set(['uuid', 'inet', 'cidr', 'time', 'interval', 'bit', 'buffer']);

/** Property names that must never be chosen as a display field, however text-shaped the column is. */
const SECRET_NAME = /password|secret|token|hash|salt|apiKey|api_key|private/i;

/**
 * The declared length above which a text column reads as prose rather than a single line. Matches the
 * conventional `varchar(255)` ceiling for single-line values — a bound set deliberately higher signals
 * long-form content.
 */
const LONG_TEXT_THRESHOLD = 255;

/**
 * Column facts Drizzle sets per column type but does not surface on the base `Column` type. Read
 * through one narrow shape rather than casting at each use.
 */
interface ColumnFacts {
	readonly length?: number;
	readonly withTimezone?: boolean;
	readonly enumValues?: readonly string[];
	readonly default?: unknown;
}

/**
 * Reads the per-type facts off a column.
 *
 * @param column - The Drizzle column.
 * @returns Its optional type-specific facts.
 */
function readFacts(column: Column): ColumnFacts {
	return column as unknown as ColumnFacts;
}

/** A column's JS-level type, split into the category it belongs to and the refinement on it. */
export interface DataType {
	/** The broad JS category — `string`, `number`, `bigint`, `boolean`, `object`, `array`. */
	readonly category: string;
	/** The refinement, when present — `date`, `numeric`, `double`, `int53`, `json`, and so on. */
	readonly constraint: string | undefined;
}

/**
 * Reads a column's data type as its two meaningful halves.
 *
 * Drizzle encodes `dataType` as `"<category> <constraint>"` — `number int53`, `string numeric`,
 * `object date` — so neither equality against a bare category nor a prefix test is reliable on its own:
 * a timestamp is `object date`, whose category says nothing useful. Splitting makes both halves
 * available, which is what the inference rules actually need.
 *
 * The `string` types here are also a deliberate widening. Drizzle rc.4 declares `dataType` as a literal
 * union that omits values it emits at runtime, so comparing against the declared union fails to compile
 * for exactly the cases that matter. Revisit once the upstream union matches runtime.
 *
 * @param column - The Drizzle column.
 * @returns The parsed category and constraint.
 */
export function readDataType(column: Column): DataType {
	const [category = '', constraint] = (column.dataType as string).split(' ');
	return { category, constraint };
}

/**
 * Whether a column stores fractional numbers.
 *
 * @param column - The Drizzle column.
 * @returns `true` for numeric/decimal/double/float columns on either dialect.
 */
function isDecimalColumn(column: Column): boolean {
	const { constraint } = readDataType(column);
	if (constraint !== undefined && DECIMAL_CONSTRAINTS.has(constraint)) return true;
	return DECIMAL_COLUMN_TYPES.some((marker) => column.columnType.includes(marker));
}

/**
 * The choices a column constrains its value to, from an enum declaration (`pgEnum` on Postgres,
 * `text({ enum })` on SQLite — both surface as `enumValues`). The stored value doubles as the editor
 * label until presentation metadata supplies a nicer name.
 *
 * @param column - The Drizzle column.
 * @returns One option per enum value, empty when the column is not an enum.
 */
function readOptions(column: Column): FieldOption[] {
	return (readFacts(column).enumValues ?? []).map((value) => ({ name: value, value }));
}

/**
 * Infers the semantic type of a column.
 *
 * Order matters: a foreign key is a relation whatever it is stored as, and an enum is a select whatever
 * its underlying type, so both are decided before the storage type is consulted.
 *
 * @param column - The Drizzle column.
 * @param reference - The column's foreign key, when it has one.
 * @returns The inferred {@link FieldType}; `unknown` when DDL cannot distinguish the intent.
 */
export function inferFieldType(column: Column, reference: ColumnReference | undefined): FieldType {
	if (reference) return reference.entity === MEDIA_ENTITY ? 'media' : 'relation';
	if (readFacts(column).enumValues?.length) return 'select';

	const { category, constraint } = readDataType(column);
	// Checked before the category: a timestamp is carried as `object date`, whose category alone
	// would fall through to `unknown`.
	if (constraint !== undefined && DATE_CONSTRAINTS.has(constraint)) return 'datetime';
	if (category === 'boolean') return 'boolean';
	if (category === 'number' || category === 'bigint') return 'number';
	if (category === 'string') {
		// Postgres `numeric` is carried as a string to preserve precision — still a number to an editor.
		return isDecimalColumn(column) ? 'number' : inferTextType(column);
	}

	// JSON and binary columns: `richText` and raw JSON are indistinguishable here, and guessing
	// `richText` would put a document editor over arbitrary data. Left for an override to correct.
	return 'unknown';
}

/**
 * Distinguishes a single-line text field from a prose one.
 *
 * Only a generous length bound implies prose; everything else defaults to a single line. That default
 * is deliberate rather than neutral, because there is usually no signal at all: SQLite `text()` carries
 * no length, so treating unbounded text as prose would give a textarea to every title, slug, name and
 * email in a SQLite schema — the overwhelmingly common case. Long-form content in a CMS is normally
 * rich text anyway, which is inferred separately.
 *
 * This is the most arbitrary inference here and the one most expected to be corrected by an override.
 *
 * @param column - A string-typed Drizzle column.
 * @returns `longText` when the column is bounded above {@link LONG_TEXT_THRESHOLD}, `shortText` otherwise.
 */
function inferTextType(column: Column): FieldType {
	const { length } = readFacts(column);
	return length !== undefined && length > LONG_TEXT_THRESHOLD ? 'longText' : 'shortText';
}

/**
 * Derives a field's configuration from its column. Structural entries come from DDL; presentational
 * entries have no DDL source and are emitted empty for an override to fill.
 *
 * @param column - The Drizzle column.
 * @returns The field's {@link FieldConfig}.
 */
export function inferFieldConfig(column: Column): FieldConfig {
	const facts = readFacts(column);
	return {
		required: column.notNull,
		maxLength: facts.length ?? null,
		decimalAllowed: isDecimalColumn(column),
		timezone: facts.withTimezone === true,
		hasDefault: column.hasDefault,
		defaultValue: readDefaultValue(column),
		options: readOptions(column),
		colorFormat: null,
		allowedTypes: [],
		previewSize: null,
	};
}

/**
 * The column's default as a JSON-safe literal, or `null` when it has none or the default is computed.
 *
 * A `defaultNow()` / `default(sql\`…\`)` default is a Drizzle `SQL` object, and a `$defaultFn()` is a
 * JavaScript function — neither is serialisable, and emitting one would leak an ORM internal into a
 * public response and render as `[object Object]` in a form. Those cases report `null` here while
 * {@link FieldConfig.hasDefault} stays `true`, so a consumer can still tell "the database will fill this
 * in" from "there is no default", which a bare `null` cannot express.
 *
 * @param column - The Drizzle column.
 * @returns The literal default, or `null`.
 */
function readDefaultValue(column: Column): unknown {
	if (!column.hasDefault) return null;
	const { default: value } = readFacts(column);
	if (value === undefined || value === null) return null;
	if (typeof value === 'object' || typeof value === 'function') return null;
	return value;
}

/**
 * Picks the field that identifies an entry to a human — shown in the list's first column and in every
 * relation picker. The first single-line text field is the best guess DDL supports; an entity whose
 * fields are all numbers or dates has no candidate and shows ids until an override names one.
 *
 * @param entity - The entity to inspect.
 * @returns The property name of the display field, or `null` when nothing suits.
 */
export function inferDisplayField(entity: Entity): string | null {
	const primaryKey = pkKey(entity);
	let fallback: string | null = null;

	for (const [key, column] of Object.entries(entity.columns)) {
		// The key identifies a row to the database, not to a person; a relation names another entry.
		if (key === primaryKey || entity.references[key]) continue;
		if (!isDisplayable(key, column)) continue;

		const fieldType = inferFieldType(column, undefined);
		if (fieldType === 'shortText') return key;
		// An unbounded `text('title')` is the common way to declare a title, so prose is a usable
		// fallback — just a worse one than a column whose bound says it holds a single line.
		if (fieldType === 'longText') fallback ??= key;
	}

	return fallback;
}

/**
 * Whether a column may be shown as an entry's human-readable name.
 *
 * Two exclusions, both reachable from an entirely ordinary schema. A UUID or IP column is text-shaped
 * but opaque, so it identifies nothing to a person. And a column whose name suggests a credential must
 * never be chosen: `displayField` feeds the list view's first column *and every relation dropdown*, so
 * picking `passwordHash` on a `users` table would scatter hashes across the Admin UI.
 *
 * @param name - The property name.
 * @param column - The Drizzle column.
 * @returns `true` when the column is safe and meaningful to show.
 */
function isDisplayable(name: string, column: Column): boolean {
	if (SECRET_NAME.test(name)) return false;
	const { constraint } = readDataType(column);
	return constraint === undefined || !OPAQUE_CONSTRAINTS.has(constraint);
}

/**
 * Finds the property name of an entity's single-column primary key.
 *
 * @param entity - The target entity.
 * @returns The PK's property name, or `undefined` when there is no single-column PK.
 */
export function pkKey(entity: Entity): string | undefined {
	for (const [key, column] of Object.entries(entity.columns)) {
		if (column === entity.pk) return key;
	}
	return undefined;
}

/**
 * Turns a property name into a human label — `publishedAt` becomes `Published at`, and both `author_id`
 * and `authorId` become `Author`, since an id suffix is plumbing rather than something to show an
 * editor. The fallback until presentation metadata supplies a real display name.
 *
 * @param name - The property name.
 * @returns A capitalised, space-separated label.
 */
export function humanise(name: string): string {
	const words = name
		.replace(/(_id|Id)$/, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.trim()
		.toLowerCase();
	if (!words) return name;
	return words.charAt(0).toUpperCase() + words.slice(1);
}
