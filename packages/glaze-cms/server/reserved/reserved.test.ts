import { expect, test } from '#harness';

import { isReservedPath, warnReservedCollisions } from './reserved.ts';

import type { Logger } from '#logger';
import type { GlazeApp } from '../app/context.ts';

test('isReservedPath matches exact and child paths, but not lookalikes', () => {
	expect(isReservedPath('/api', ['/api'])).toBe(true);
	expect(isReservedPath('/api/posts', ['/api'])).toBe(true);
	// boundary: `/apidocs` is not under `/api`
	expect(isReservedPath('/apidocs', ['/api'])).toBe(false);
	expect(isReservedPath('/newsletter', ['/api', '/admin'])).toBe(false);
});

test('warnReservedCollisions warns only for user routes under a reserved prefix', () => {
	const coreRoutes = new Set(['GET /_health']);
	const app = {
		routes: [
			{ method: 'GET', path: '/_health' }, // core — excluded by the snapshot
			{ method: 'GET', path: '/newsletter' }, // user, allowed
			{ method: 'POST', path: '/api/hack' }, // user, reserved → warn
		],
	} as unknown as GlazeApp;

	const messages: string[] = [];
	const logger = { warn: (message: string) => messages.push(message) } as unknown as Logger;

	warnReservedCollisions(app, coreRoutes, ['/api'], logger);

	expect(messages).toHaveLength(1);
	expect(messages[0]).toContain('POST /api/hack');
});
