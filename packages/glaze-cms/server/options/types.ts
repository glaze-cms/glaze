/**
 * `GlazeOptions` — the runtime configuration passed to {@link glaze}: the "how the server behaves"
 * half of Glaze's config (port/security/prefixes/health/logger). It is deliberately **distinct** from
 * the tooling `GlazeConfig` (dialect/connection/schema/migrations/workflow) loaded from `glaze.config.ts`.
 * Every field is optional; {@link resolveOptions} fills the secure defaults.
 */

import type { LoggerOptions } from '#logger';

/** CORS for the external content API (never applied to the same-origin admin — see CLAUDE.md §10). */
export interface CorsOptions {
	/** Allowed origin(s). Omitted ⇒ **deny** (no `Access-Control-Allow-Origin` emitted). */
	readonly origin?: string | RegExp | Array<string | RegExp>;
	/** Send credentials; only honored when an explicit `origin` is given (never with a wildcard). */
	readonly credentials?: boolean;
}

/** Security-header options; a locked secure baseline the user can extend (not weaken). */
export interface HeadersOptions {
	/** Extra Content-Security-Policy directives merged onto the secure `default-src 'self'` baseline. */
	readonly csp?: Readonly<Record<string, string>>;
	/** Send HSTS. Defaults to on in production, off otherwise. */
	readonly hsts?: boolean;
}

/** Security surfaces the user may configure. */
export interface SecurityOptions {
	/** Content-API CORS (deny-by-default). */
	readonly cors?: CorsOptions;
	/** Response security headers (CSP/HSTS/…). */
	readonly headers?: HeadersOptions;
}

/** Route-prefix options. */
export interface PrefixOptions {
	/** Admin app mount prefix. @default '/admin' */
	readonly admin?: string;
	/** Content/API mount prefix. @default '/api' */
	readonly api?: string;
}

/** Health-check options. */
export interface HealthOptions {
	/** Whether the health route is registered. @default true */
	readonly enabled?: boolean;
	/** The health route path. @default '/_health' */
	readonly path?: string;
}

/** The runtime options passed to `glaze({…})`. All optional; see {@link resolveOptions} for defaults. */
export interface GlazeOptions {
	/** The port to listen on. Falls back to `PORT`/`GLAZE_PORT` env, then `4000`. */
	readonly port?: number;
	/** CORS + security-header configuration. */
	readonly security?: SecurityOptions;
	/** Admin/API route prefixes. */
	readonly prefixes?: PrefixOptions;
	/** Health-check configuration. */
	readonly health?: HealthOptions;
	/** Logger configuration (forwarded to the Glaze logger). */
	readonly logger?: LoggerOptions;
}

/** Fully-resolved security headers (defaults applied). */
export interface ResolvedHeadersOptions {
	/** The effective CSP directives (secure baseline merged with any user additions). */
	readonly csp: Readonly<Record<string, string>>;
	/** Whether HSTS is sent. */
	readonly hsts: boolean;
}

/** Fully-resolved runtime options — every field concrete, consumed by the composition root. */
export interface ResolvedGlazeOptions {
	/** The resolved port to listen on. */
	readonly port: number;
	/** Resolved security surfaces. */
	readonly security: {
		/** Content-API CORS, or `undefined` for deny-by-default. */
		readonly cors: CorsOptions | undefined;
		/** Resolved security headers. */
		readonly headers: ResolvedHeadersOptions;
	};
	/** Resolved, normalized route prefixes. */
	readonly prefixes: { readonly admin: string; readonly api: string };
	/** Resolved health config. */
	readonly health: { readonly enabled: boolean; readonly path: string };
	/** Logger configuration, or `undefined`. */
	readonly logger: LoggerOptions | undefined;
}
