/**
 * The content-model descriptor: the machine-readable shape the Admin UI renders from, served by
 * `GET {apiPrefix}/schema`.
 *
 * Two things about this contract are deliberate and load-bearing (see `specs/design/content.md`):
 *
 * 1. **Fields nest.** {@link FieldDescriptor} is a tagged union rather than a flat column list, so
 *    composite structures (groups, repeaters, blocks) are added additively instead of breaking the
 *    endpoint the Admin UI depends on most. Only `field` is emitted today.
 * 2. **Presentation keys are always present.** `label`, `description`, `displayField` and friends have
 *    no DDL source; they are inferred (or `null`) until the presentation layer exists, at which point
 *    stored overrides change how they RESOLVE, never the response shape. {@link FieldTypeSource}
 *    records which happened.
 */

/**
 * The semantic type of a field — what kind of value it holds, and therefore which control an editor
 * gets. Distinct from the column's storage type: `shortText` and `longText` are both text, while
 * `select` and `relation` are both usually a string or an integer.
 */
export type FieldType =
	| 'shortText'
	| 'longText'
	| 'richText'
	| 'number'
	| 'boolean'
	| 'datetime'
	| 'select'
	| 'multiSelect'
	| 'color'
	| 'media'
	| 'relation'
	| 'unknown';

/** Where a field's resolved {@link FieldType} came from. */
export type FieldTypeSource =
	/** Derived from the column's own facts — the only source until presentation storage exists. */
	| 'inferred'
	/** Read from stored presentation metadata, which outranks inference. */
	| 'override';

/** How many entries a relation points at. */
export type RelationCardinality = 'one' | 'many';

/** A column's JS-level type, split into the category it belongs to and any refinement on it. */
export interface DataTypeInfo {
	/** The broad JS category — `string`, `number`, `bigint`, `boolean`, `object`, `array`. */
	readonly category: string;
	/** The refinement, when the column has one — `date`, `numeric`, `double`, `int53`, `json`. */
	readonly constraint: string | null;
}

/** A choice offered by a `select` / `multiSelect` field. */
export interface FieldOption {
	/** The label shown to editors — presentation. */
	readonly name: string;
	/** The value stored in the database — data. */
	readonly value: string;
}

/** What a `relation` field points at, and how editors identify the entries it offers. */
export interface RelationTarget {
	/** The entity being pointed at. */
	readonly entity: string;
	/** The column joined on, in the target entity. */
	readonly column: string;
	/** One entry or many. */
	readonly cardinality: RelationCardinality;
	/**
	 * The target field shown in pickers to identify an entry. Falls back to the target's own
	 * `displayField` when unset.
	 */
	readonly displayField: string | null;
	/**
	 * Whether this relation can be written today. Many-to-many relations derived from a junction table
	 * are read-only until the write path exists.
	 */
	readonly writable: boolean;
}

/**
 * Configuration carried by a field. Structural entries are derived from the column and changing them
 * requires a migration; presentational entries have no DDL source and apply immediately.
 */
export interface FieldConfig {
	/** Structural — `NOT NULL`. */
	readonly required: boolean;
	/** Structural — a bounded `varchar(n)`; `null` when unbounded. */
	readonly maxLength: number | null;
	/** Structural — the column accepts fractional values (`numeric`/`real`, not `integer`). */
	readonly decimalAllowed: boolean;
	/** Structural — the column is timezone-aware (`timestamptz`). */
	readonly timezone: boolean;
	/**
	 * Structural — whether the database supplies a value when one is not sent. Separate from
	 * {@link defaultValue} because a computed default (`now()`, an auto-increment key) has no literal to
	 * report: without this flag a `serial` primary key looks required-with-no-default, and a form would
	 * demand the editor type one.
	 */
	readonly hasDefault: boolean;
	/**
	 * Structural — the column's `DEFAULT` as a JSON-safe literal, or `null` when it has none or the
	 * default is computed. Check {@link hasDefault} to tell those apart.
	 */
	readonly defaultValue: unknown;
	/** Choices for `select` / `multiSelect`; empty when the field is neither. */
	readonly options: readonly FieldOption[];
	/** Presentation — how a `color` value is written. `null` unless the field is a colour. */
	readonly colorFormat: 'hex' | 'rgb' | 'hsl' | null;
	/** Presentation — media kinds a `media` field accepts. Empty unless the field is media. */
	readonly allowedTypes: readonly ('image' | 'video' | 'file')[];
	/** Presentation — how a `media` field previews. `null` unless the field is media. */
	readonly previewSize: 'full' | 'compact' | null;
}

/** A single value, stored in one column — the leaf of the descriptor tree. */
export interface FieldNode {
	readonly kind: 'field';
	/** The property key on the Drizzle table; the key in a request/response body. */
	readonly name: string;
	/**
	 * The underlying database column name, which may differ from `name`. `null` for a field with no
	 * column of its own — a many-to-many relation, whose link lives in a junction table.
	 */
	readonly column: string | null;
	/**
	 * Drizzle's JS-level type category and refinement, e.g. `number` + `int53`, `string` + `numeric`,
	 * `object` + `date`. `null` for a field with no column.
	 *
	 * Reported as parsed halves rather than Drizzle's raw compound string because that string is not
	 * stable across dialects — the same logical column is `number int32` on Postgres and `number int53`
	 * on SQLite — and because it is an internal of the ORM rather than part of any published contract.
	 * Prefer {@link FieldNode.fieldType} for rendering; this is for consumers that need the storage
	 * detail.
	 */
	readonly dataType: DataTypeInfo | null;
	/** Whether this column is the entity's primary key. */
	readonly isPrimaryKey: boolean;
	/** The resolved semantic type. */
	readonly fieldType: FieldType;
	/** Whether {@link fieldType} was inferred or overridden. */
	readonly fieldTypeSource: FieldTypeSource;
	/** Presentation — the human label. Inferred from `name` until an override exists. */
	readonly label: string;
	/** Presentation — the hint shown under the field. `null` until an override exists. */
	readonly description: string | null;
	/** Set when {@link fieldType} is `relation` or `media`; `null` otherwise. */
	readonly relation: RelationTarget | null;
	/** The field's configuration. */
	readonly config: FieldConfig;
}

/**
 * Several fields presented together under one heading. Purely visual — the columns are flat and
 * independently queryable, so a group exists only in presentation metadata.
 *
 * Reserved: not emitted until the presentation layer exists.
 */
export interface GroupNode {
	readonly kind: 'group';
	readonly name: string;
	readonly label: string;
	readonly description: string | null;
	readonly fields: readonly FieldDescriptor[];
}

/**
 * A list of rows that all share the same fields, stored as a JSON array in one column.
 *
 * Reserved: not emitted. The inner fields have no DDL, so where their definitions live is unresolved.
 */
export interface RepeaterNode {
	readonly kind: 'repeater';
	readonly name: string;
	readonly column: string;
	readonly label: string;
	readonly description: string | null;
	readonly fields: readonly FieldDescriptor[];
}

/**
 * A list whose items may each be a different shape, chosen from a palette — the page-builder pattern,
 * stored relationally across per-block tables and a junction carrying the order.
 *
 * Reserved: not emitted. How Glaze recognises such a table set is unresolved.
 */
export interface BlocksNode {
	readonly kind: 'blocks';
	readonly name: string;
	readonly label: string;
	readonly description: string | null;
	/** The block shapes this field accepts, each a named group of fields. */
	readonly blocks: readonly GroupNode[];
}

/** Any node in an entity's field tree. */
export type FieldDescriptor = FieldNode | GroupNode | RepeaterNode | BlocksNode;

/**
 * How many entries an entity holds.
 *
 * Reserved: always `multiple`. Nothing in DDL distinguishes a Single — a table holding exactly one row
 * looks like any other — so the distinction is a declaration that belongs to the presentation layer.
 * The key exists now so adding it later changes a value rather than the shape.
 */
export type EntityKind = 'multiple' | 'single';

/** Which operations an entity's routes support. */
export interface EntityCapabilities {
	/** Read one entry by id — requires a single-column primary key. */
	readonly byId: boolean;
	/** Create an entry. */
	readonly create: boolean;
	/** Update an entry by id. */
	readonly update: boolean;
	/** Delete an entry by id. */
	readonly delete: boolean;
}

/** The order entries appear in before an editor sorts the table themselves. */
export interface DefaultSort {
	/** The field name sorted on. */
	readonly field: string;
	/** The direction. */
	readonly direction: 'asc' | 'desc';
}

/**
 * One content entity, as the Admin UI sees it.
 *
 * @example
 * ```ts
 * const res: ApiResponse<ContentModel> = await (await fetch('/api/entities')).json();
 * if (!res.success) return;
 * for (const entity of res.data.entities) {
 * 	console.log(entity.label, entity.fields.length);
 * }
 * ```
 */
export interface EntityDescriptor {
	/** The entity name — the Drizzle table name and the `/api/{name}` route segment. */
	readonly name: string;
	/** Whether the entity holds many entries or exactly one. */
	readonly kind: EntityKind;
	/** Presentation — the human label. Inferred from `name` until an override exists. */
	readonly label: string;
	/** Presentation — a description of the entity. `null` until an override exists. */
	readonly description: string | null;
	/** The single-column primary key's field name, or `null` when the table has none. */
	readonly primaryKey: string | null;
	/**
	 * The field identifying an entry — used for the list's first column and in every relation picker.
	 * Inferred as the first text field until an override exists; `null` when there is no candidate.
	 */
	readonly displayField: string | null;
	/** The order entries are listed in when the request does not sort explicitly. */
	readonly defaultSort: DefaultSort | null;
	/**
	 * Whether entries can be drafted before publishing.
	 *
	 * Reserved: always `false`. Draft & Publish is unimplemented — the key exists so the contract
	 * absorbs it without a break.
	 */
	readonly draftPublish: boolean;
	/** Which routes this entity actually serves. */
	readonly capabilities: EntityCapabilities;
	/** The field tree. */
	readonly fields: readonly FieldDescriptor[];
}

/** The payload of `GET {apiPrefix}/entities`: the whole content model. */
export interface ContentModel {
	/** Every servable entity, in load order. */
	readonly entities: readonly EntityDescriptor[];
}
