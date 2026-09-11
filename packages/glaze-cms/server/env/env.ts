/**
 * Boot-time environment validation. Glaze's env surface is validated against a compiled TypeBox schema
 * before the server touches the database or auth, so a misconfigured deployment fails **immediately**
 * with a per-variable message and an actionable hint — rather than surfacing as an obscure error deep
 * in boot (or, worse, a running-but-insecure server).
 *
 * TypeBox is the validator Elysia already loads (`typebox`), so this adds no new runtime and no second
 * validation library.
 *
 * Scope is **Glaze-owned** env only. The database connection lives in `glaze.config.ts` (validated by
 * the config resolver), not here. `CI` / `GLAZE_NO_TTY` are ambient interactivity flags parsed
 * leniently elsewhere ({@link isEnvFlagEnabled}), not strict config — so they are deliberately absent.
 */

import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { Value } from 'typebox/value';

import { DEFAULT_PORT, MIN_AUTH_SECRET_LENGTH, MIN_SETUP_TOKEN_LENGTH } from '#consts';
import { isProduction } from '#utils';

import type { Logger } from '#logger';
import type { Static } from 'typebox';

/** Recognized `NODE_ENV` values; the first three are treated as local for hint wording. */
const NODE_ENVS = ['local', 'development', 'test', 'staging', 'production'] as const;

/** The validated, typed Glaze environment. */
export type GlazeEnv = Static<typeof GlazeEnvSchema>;

/** One environment error, ready to print: the variable, what's wrong, and how to fix it. */
export interface EnvError {
	readonly variable: string;
	readonly message: string;
	readonly hint: string;
}

/** The outcome of {@link parseEnv}: the typed env, or the list of per-variable errors. */
export type ParseEnvResult =
	| { readonly success: true; readonly env: GlazeEnv }
	| { readonly success: false; readonly errors: readonly EnvError[] };

/**
 * The Glaze environment schema. `GLAZE_AUTH_SECRET` is optional here (format-checked only when set);
 * its "required in production" rule is applied separately in {@link parseEnv}, so dev keeps the
 * insecure-fallback DX from `server/auth/secret.ts` without a second hard guard.
 */
const GlazeEnvSchema = Type.Object({
	NODE_ENV: Type.Union(
		NODE_ENVS.map((value) => Type.Literal(value)),
		{ default: 'development' },
	),
	GLAZE_AUTH_SECRET: Type.Optional(Type.String({ minLength: MIN_AUTH_SECRET_LENGTH })),
	GLAZE_AUTH_URL: Type.Optional(Type.String({ minLength: 1, pattern: '^https?://' })),
	GLAZE_SETUP_TOKEN: Type.Optional(Type.String({ minLength: MIN_SETUP_TOKEN_LENGTH })),
	GLAZE_PORT: Type.Integer({ default: DEFAULT_PORT, minimum: 1, maximum: 65535 }),
});

/** Friendly, human-first messages per variable; falls back to TypeBox's own message for anything else. */
const FRIENDLY_MESSAGE: Readonly<Record<string, string>> = {
	NODE_ENV: `must be one of: ${NODE_ENVS.join(', ')}`,
	GLAZE_AUTH_SECRET: `must be at least ${MIN_AUTH_SECRET_LENGTH} characters`,
	GLAZE_AUTH_URL: 'must be a URL starting with http:// or https://',
	GLAZE_SETUP_TOKEN: `must be at least ${MIN_SETUP_TOKEN_LENGTH} characters`,
	GLAZE_PORT: 'must be a whole number between 1 and 65535',
};

/** Compiled once at module load — validation runs cheaply thereafter. */
const EnvValidator = Compile(GlazeEnvSchema);

/**
 * Validates the environment and, on failure, prints each problem (variable + message + fix hint)
 * through the logger, then throws so boot stops before the server starts.
 *
 * @param logger - The logger to report validation problems through.
 * @returns The validated, typed environment.
 * @throws {Error} When one or more environment variables are missing or invalid.
 */
export function validateEnv(logger: Logger): GlazeEnv {
	const result = parseEnv();
	if (result.success) return result.env;

	logger.error('Environment validation failed:');
	for (const error of result.errors) {
		logger.error(`  ${error.variable} ${error.message}`);
		logger.info(`  👉 ${error.hint}`);
	}

	const summary = result.errors.map((error) => `${error.variable} ${error.message}`).join('; ');
	throw new Error(`Environment validation failed: ${summary}`);
}

/**
 * Reads and validates the environment without throwing: applies defaults, coerces types (string →
 * number), checks the schema, and adds the production-only auth-secret rule.
 *
 * @returns `{ success: true, env }` when valid, else `{ success: false, errors }`.
 */
export function parseEnv(): ParseEnvResult {
	const defaulted = Value.Default(GlazeEnvSchema, Value.Clone(readRawEnv()));
	const converted = Value.Convert(GlazeEnvSchema, defaulted) as GlazeEnv;

	const errors = collectErrors(converted);
	if (errors.length > 0) return { success: false, errors };

	return { success: true, env: converted };
}

/**
 * Reads an env var as a trimmed value, treating empty/whitespace-only as **unset** — so a blank
 * `GLAZE_AUTH_SECRET=` (common when copied from `.env.example`) behaves like absent (dev fallback /
 * prod error) rather than failing the format check, matching `server/auth/secret.ts`.
 *
 * @param name - The environment variable name.
 * @returns The trimmed value, or `undefined` when unset or blank.
 */
function getEnv(name: string): string | undefined {
	const value = process.env[name]?.trim();
	if (!value) return undefined;
	return value;
}

/**
 * Collects the raw Glaze env values into a plain object, honoring the `GLAZE_PORT` → `PORT` fallback.
 * Unset (or blank) variables are omitted so schema defaults apply.
 *
 * @returns The raw, pre-validation env object.
 */
function readRawEnv(): Record<string, unknown> {
	const raw: Record<string, unknown> = {};
	const nodeEnv = getEnv('NODE_ENV');
	const port = getEnv('GLAZE_PORT') ?? getEnv('PORT');
	const secret = getEnv('GLAZE_AUTH_SECRET');
	const authUrl = getEnv('GLAZE_AUTH_URL');
	const setupToken = getEnv('GLAZE_SETUP_TOKEN');

	if (nodeEnv !== undefined) raw['NODE_ENV'] = nodeEnv;
	if (port !== undefined) raw['GLAZE_PORT'] = port;
	if (secret !== undefined) raw['GLAZE_AUTH_SECRET'] = secret;
	if (authUrl !== undefined) raw['GLAZE_AUTH_URL'] = authUrl;
	if (setupToken !== undefined) raw['GLAZE_SETUP_TOKEN'] = setupToken;

	return raw;
}

/**
 * Runs the compiled schema over the converted env and appends the production-only rule that
 * `GLAZE_AUTH_SECRET` must be present. Keeps at most one error per variable, in schema order.
 *
 * @param env - The defaulted, type-converted environment.
 * @returns The de-duplicated list of environment errors (empty when valid).
 */
function collectErrors(env: GlazeEnv): EnvError[] {
	const byVariable = new Map<string, EnvError>();
	const local = isLocalEnv(env.NODE_ENV);

	for (const error of EnvValidator.Errors(env)) {
		const variable = error.instancePath.replace(/^\//, '');
		if (variable === '' || byVariable.has(variable)) continue;
		byVariable.set(variable, {
			variable,
			message: FRIENDLY_MESSAGE[variable] ?? error.message,
			hint: hintFor(variable, local),
		});
	}

	if (isProduction() && getEnv('GLAZE_AUTH_SECRET') === undefined) {
		byVariable.set('GLAZE_AUTH_SECRET', {
			variable: 'GLAZE_AUTH_SECRET',
			message: 'is required in production',
			hint: hintFor('GLAZE_AUTH_SECRET', false),
		});
	}

	return [...byVariable.values()];
}

/**
 * Whether the environment is a local/dev-style one, which chooses `.env`-file wording for hints.
 *
 * @param nodeEnv - The resolved `NODE_ENV`.
 * @returns `true` for local, development, or test.
 */
function isLocalEnv(nodeEnv: GlazeEnv['NODE_ENV']): boolean {
	return nodeEnv === 'local' || nodeEnv === 'development' || nodeEnv === 'test';
}

/**
 * Builds the actionable "how to fix it" hint for a variable, tuned to where the value belongs.
 *
 * @param variable - The environment variable name.
 * @param local - Whether the process is running in a local/dev environment.
 * @returns The hint string.
 */
function hintFor(variable: string, local: boolean): string {
	return local
		? `Set ${variable} in your .env file`
		: `Set ${variable} as an environment variable in your hosting provider`;
}
