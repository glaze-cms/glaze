import type { Elysia } from 'elysia';
import type { DrizzleDatabase } from '@glaze/convergence';
import type { GlazeEnv, GlazeInternalConfig, Role } from '@glaze/config';
import type { Logger } from '@glaze/logger';

/**
 * Wraps route options that include the `requireRole` macro.
 *
 * TypeScript's excess-property check rejects `requireRole` on raw object literals
 * because it isn't part of Elysia's `LocalHook` type — the macro type only lives
 * on the Elysia instance that defines it. Passing options through this function
 * switches TS to structural compatibility checking, where extra properties are
 * allowed, while still validating that `requireRole` is a valid `Role` value.
 */
// Overload 1: requireRole only (no additional schema options, e.g. DELETE routes)

export function glazeHook(opts: { requireRole: Role }): any;
// Overload 2: requireRole + schema options (e.g. POST/PATCH routes with body)
export function glazeHook<T extends Record<string, unknown>>(
	opts: { requireRole: Role } & T,
): T;

export function glazeHook(opts: any): any {
	return opts;
}

export type GlazeApp = Elysia<
	string,
	{
		decorator: {
			env: GlazeEnv;
			logger: Logger;
			config: GlazeInternalConfig;
			schema: Record<string, unknown>;
			db: DrizzleDatabase;
		};
		store: Record<never, never>;
		derive: Record<never, never>;
		resolve: Record<never, never>;
	}
>;
