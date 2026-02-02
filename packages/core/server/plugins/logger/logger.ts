import Elysia from 'elysia';
import type { Logger } from 'pino';

/**
 * Inject a logger into an Elysia application instance
 * @param loggerInstance - A Pino Logger instance to be injected into the Elysia app context
 */
export const loggerPlugin = (logger: Logger) =>
	new Elysia({ name: '@glaze/logger' }).decorate('logger', logger);
