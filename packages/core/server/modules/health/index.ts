import { Elysia } from 'elysia';

/* Handler */
import { handleHealthCheck } from './handler';

/* Types */
import type { GlazeEnv } from '../../validators/env';

export function healthCheckModule() {
	return new Elysia({ name: '@glaze/health' })
		.decorate('env', {} as GlazeEnv)
		.get('/_health', ({ env }) => handleHealthCheck(env));
}
