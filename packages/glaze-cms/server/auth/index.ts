export { createAuth } from './instance.ts';
export { createAuthMacro } from './macro.ts';
export { createAuthPlugin } from './plugin.ts';
export { materializeAuthTables } from './materializer.ts';
export {
	AUTH_EXPECTED_COLUMNS,
	AUTH_PG_SCHEMA,
	AUTH_SQLITE_PREFIX,
	buildAuthSchema,
} from './schema/index.ts';
export { resolveAuthProvider } from './provider.ts';

export type { GlazeAuth } from './instance.ts';
export type { SessionProvider } from './macro.ts';
export type { AuthModelName, AuthSchema } from './schema/index.ts';
export type { AuthProvider } from './provider.ts';
