import Elysia from 'elysia';

/* Handler */
import { handleAdmin } from './handler';

/* Types */
import type { GlazeEnv } from '../../validators/env';

export function adminModule() {
	return new Elysia({ name: '@glaze/admin' })
		.decorate('env', {} as GlazeEnv)
		.all('/admin/*', ({ env, request, path }) =>
			handleAdmin({ env, request, path }),
		);
}
