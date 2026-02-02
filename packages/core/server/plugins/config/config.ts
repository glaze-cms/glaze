import Elysia from 'elysia';

import type { GlazeInternalConfig } from '../../validators/config/config';

/**
 * Elysia plugin to inject the Glaze internal config.
 * @param config - The Glaze internal config
 * @returns An Elysia plugin that decorates the app with the config
 */
export const configPlugin = (config: GlazeInternalConfig) =>
	new Elysia({ name: '@glaze/config' }).decorate('config', config);
