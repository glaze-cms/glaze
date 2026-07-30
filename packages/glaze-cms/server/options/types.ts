/**
 * `GlazeOptions` — the runtime configuration passed to {@link glaze}: the "how the server behaves"
 * half of Glaze's config (port/security/prefixes/health/logger). It is deliberately **distinct** from
 * the tooling `GlazeConfig` (dialect/connection/schema/migrations/workflow) loaded from `glaze.config.ts`.
 * Every field is optional; {@link resolveOptions} fills the secure defaults.
 */

import type { LoggerOptions } from '#logger';
import type { ElysiaOpenAPIConfig } from '@elysiajs/openapi';

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

/** Interactive API reference docs (Scalar / Swagger), generated from your content routes. */
export interface APIDocsOptions {
	/** Whether the docs UI and OpenAPI spec are served. @default true */
	readonly enabled?: boolean;
	/** Mount path for the docs UI (the spec is served beneath it). @default '/openapi' */
	readonly path?: string;
	/** Which reference UI to render. @default 'scalar' */
	readonly provider?: 'scalar' | 'swagger';
	/** OpenAPI document metadata — title, description, version, servers, tags, security schemes. */
	readonly documentation?: ElysiaOpenAPIConfig['documentation'];
	/** Scalar UI options — theme, dark mode, layout, and the like. */
	readonly scalar?: ElysiaOpenAPIConfig['scalar'];
	/** Swagger UI options. */
	readonly swagger?: ElysiaOpenAPIConfig['swagger'];
}

/** Content-API options — which of the schema's tables get generated CRUD routes. */
export interface ContentOptions {
	/**
	 * Collection (table) names to **not** serve CRUD for. Excluded tables are still created and evolved
	 * by convergence — they simply get no `/api/{collection}` routes (e.g. internal join tables, or
	 * tables you serve by hand). @default []
	 */
	readonly exclude?: readonly string[];
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
	/** Content-API configuration (which tables get CRUD routes). */
	readonly content?: ContentOptions;
	/** API reference docs (Scalar/Swagger) configuration. */
	readonly docs?: APIDocsOptions;
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
	/** Resolved content config — the collection names to exclude from CRUD. */
	readonly content: { readonly exclude: readonly string[] };
	/** Resolved API-docs config (enabled/path/provider concrete; UI + metadata passed through). */
	readonly docs: {
		readonly enabled: boolean;
		readonly path: string;
		readonly provider: 'scalar' | 'swagger';
		readonly documentation: APIDocsOptions['documentation'];
		readonly scalar: APIDocsOptions['scalar'];
		readonly swagger: APIDocsOptions['swagger'];
	};
	/** Logger configuration, or `undefined`. */
	readonly logger: LoggerOptions | undefined;
}
