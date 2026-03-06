import type { Entitlement, Role } from '../types';

export const ROLE_HIERARCHY: readonly Role[] = [
	'guest',
	'writer',
	'editor',
	'admin',
] as const;

export function hasMinRole(userRole: Role, minRole: Role): boolean {
	return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(minRole);
}

export const ENTITLEMENTS: Record<Role, readonly Entitlement[]> = Object.freeze(
	{
		admin: Object.freeze([
			'system:write',
			'users:manage',
			'schema:read',
			'schema:write',
			'content:read',
			'content:write',
			'content:delete',
			'content:publish',
		] as const),
		editor: Object.freeze([
			'schema:read',
			'schema:write',
			'content:read',
			'content:write',
			'content:delete',
			'content:publish',
		] as const),
		writer: Object.freeze(['content:read', 'content:write'] as const),
		guest: Object.freeze(['schema:read', 'content:read'] as const),
	},
);
