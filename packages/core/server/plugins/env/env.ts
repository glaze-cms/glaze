import Elysia from 'elysia';

import type { GlazeEnv } from '../../validators/env';

/**
 * Elysia plugin to inject environment variables.
 * @param env - The Glaze environment variables
 * @returns An Elysia plugin that decorates the app with the env variables
 */
export const envPlugin = (env: GlazeEnv) =>
	new Elysia({ name: '@glaze/env' }).decorate('env', env);
