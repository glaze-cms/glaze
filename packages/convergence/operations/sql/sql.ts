import format from 'pg-format';

import type {
	FieldDef,
	FieldType,
	LiteralDefault,
	ExprDefault,
} from '../types/index';

// ─── Type mapping ─────────────────────────────────────────────────────────────

const TYPE_MAP: Record<FieldType, string> = {
	text: 'TEXT',
	integer: 'INTEGER',
	boolean: 'BOOLEAN',
	timestamp: 'TIMESTAMP',
	uuid: 'UUID',
	jsonb: 'JSONB',
	numeric: 'NUMERIC',
};

export function mapType(type: FieldType): string {
	return TYPE_MAP[type];
}

// ─── Default value handling ───────────────────────────────────────────────────

/**
 * Canonical SQL expression defaults per field type.
 * Exposed so the admin UI can suggest a sensible default per type.
 */
export const TYPE_DEFAULT_EXPR: Partial<Record<FieldType, ExprDefault>> = {
	timestamp: { expr: 'NOW()' },
	uuid: { expr: 'gen_random_uuid()' },
};

function isExprDefault(value: unknown): value is ExprDefault {
	return typeof value === 'object' && value !== null && 'expr' in value;
}

/**
 * Renders a default value as a SQL fragment.
 * Expression defaults are embedded directly (safe — closed whitelist).
 * Literal defaults are escaped via pg-format %L (quote_literal semantics).
 */
function renderDefault(value: LiteralDefault | ExprDefault): string {
	if (isExprDefault(value)) return value.expr;
	if (value === null) return 'NULL';
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
	if (typeof value === 'number') return String(value);
	return format('%L', value);
}

// ─── Column definition ────────────────────────────────────────────────────────

function buildColumnDef(field: FieldDef): string {
	const parts: string[] = [format('%I', field.name), mapType(field.type)];

	if (field.primaryKey) {
		parts.push('PRIMARY KEY');
	} else if (field.nullable === false) {
		parts.push('NOT NULL');
	}

	if (field.default !== undefined) {
		parts.push(`DEFAULT ${renderDefault(field.default)}`);
	}

	if (field.unique && !field.primaryKey) {
		parts.push('UNIQUE');
	}

	return parts.join(' ');
}

// ─── Collection SQL ───────────────────────────────────────────────────────────

export function buildCreateTableSQL(name: string, fields: FieldDef[]): string {
	const columns = fields.map(buildColumnDef).join(', ');
	return format('CREATE TABLE %I (%s);', name, columns);
}

export function buildRenameTableSQL(name: string, newName: string): string {
	return format('ALTER TABLE %I RENAME TO %I;', name, newName);
}

export function buildDropTableSQL(name: string): string {
	return format('DROP TABLE %I;', name);
}

// ─── Field SQL ────────────────────────────────────────────────────────────────

export function buildAddColumnSQL(table: string, field: FieldDef): string {
	return format('ALTER TABLE %I ADD COLUMN %s;', table, buildColumnDef(field));
}

export function buildRenameColumnSQL(
	table: string,
	field: string,
	newName: string,
): string {
	return format(
		'ALTER TABLE %I RENAME COLUMN %I TO %I;',
		table,
		field,
		newName,
	);
}

export function buildDropColumnSQL(table: string, field: string): string {
	return format('ALTER TABLE %I DROP COLUMN %I;', table, field);
}

export function buildSetNotNullSQL(table: string, field: string): string {
	return format('ALTER TABLE %I ALTER COLUMN %I SET NOT NULL;', table, field);
}

export function buildDropNotNullSQL(table: string, field: string): string {
	return format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL;', table, field);
}

export function buildSetDefaultSQL(
	table: string,
	field: string,
	value: LiteralDefault | ExprDefault,
): string {
	return format(
		'ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s;',
		table,
		field,
		renderDefault(value),
	);
}

export function buildDropDefaultSQL(table: string, field: string): string {
	return format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT;', table, field);
}
