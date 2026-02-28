export type FieldType =
	| 'text'
	| 'integer'
	| 'boolean'
	| 'timestamp'
	| 'uuid'
	| 'jsonb'
	| 'numeric';

/** Safe whitelist of SQL expression defaults — no arbitrary SQL accepted. */
export type DefaultExpression =
	| 'NOW()'
	| 'CURRENT_TIMESTAMP'
	| 'gen_random_uuid()';

export type ExprDefault = { expr: DefaultExpression };
export type LiteralDefault = string | number | boolean | null;

export interface FieldDef {
	name: string;
	type: FieldType;
	/** @default true */
	nullable?: boolean;
	default?: LiteralDefault | ExprDefault;
	primaryKey?: boolean;
	unique?: boolean;
}

/**
 * Error code returned when a schema operation fails.
 * Kept as `string` initially — tightened to a union as real cases emerge.
 */
export type ErrorCode = string;

export type OperationResult<T = void> =
	| { success: true; sql: string; data?: T }
	| { success: false; code: ErrorCode; error: Record<string, unknown> };
