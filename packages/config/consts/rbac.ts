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

export const ENTITLEMENTS: Record<Role, ReadonlySet<Entitlement>> = {
	admin: new Set([
		'system:write',
		'users:manage',
		'schema:read',
		'schema:write',
		'content:read',
		'content:write',
		'content:delete',
		'content:publish',
	]),
	editor: new Set([
		'schema:read',
		'schema:write',
		'content:read',
		'content:write',
		'content:delete',
		'content:publish',
	]),
	writer: new Set(['content:read', 'content:write']),
	guest: new Set(['schema:read', 'content:read']),
} as const;
