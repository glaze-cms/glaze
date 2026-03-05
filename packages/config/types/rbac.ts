export type Role = 'admin' | 'editor' | 'writer' | 'guest';

export type Entitlement =
	| 'system:write'
	| 'users:manage'
	| 'schema:read'
	| 'schema:write'
	| 'content:read'
	| 'content:write'
	| 'content:delete'
	| 'content:publish';
