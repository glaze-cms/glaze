/**
 * The typed error codes the Glaze API can return in the `{ success, data, error }` envelope.
 * Mirrors `GlazeErrorCode` in the server package.
 */
export type GlazeErrorCode =
	| 'VALIDATION'
	| 'NOT_FOUND'
	| 'INVALID_ID'
	| 'UNAUTHORIZED'
	| 'CONFLICT'
	| 'FOREIGN_KEY'
	| 'NOT_NULL'
	| 'CHECK'
	| 'INTERNAL';

/** A per-field validation message, present on `VALIDATION` and constraint errors. */
export interface FieldError {
	readonly path: string;
	readonly message: string;
}

/** An error carrying the HTTP status and the typed code from the API envelope. */
export class ApiError extends Error {
	readonly status: number;
	readonly code: GlazeErrorCode;
	readonly fields: readonly FieldError[];

	constructor(
		status: number,
		code: GlazeErrorCode,
		message: string,
		fields: readonly FieldError[] = [],
	) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.fields = fields;
	}

	/** Whether this error means the session is gone and the viewer must sign in again. */
	get isUnauthorized(): boolean {
		return this.status === 401 || this.code === 'UNAUTHORIZED';
	}
}
