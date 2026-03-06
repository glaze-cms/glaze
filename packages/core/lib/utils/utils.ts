import type { OperationResult } from '@glaze/convergence';

// Converts an OperationResult into a plain HTTP response body.
export function operationToResponse(result: OperationResult) {
	if (result.success) {
		return { sql: result.sql };
	}
	return { code: result.code, error: result.error };
}
