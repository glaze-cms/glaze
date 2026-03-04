import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { rbacPlugin } from './rbac';

const mockConfig = {
	apiPrefix: '/api',
} as Parameters<typeof rbacPlugin>[0];

describe('rbacPlugin', () => {
	test('initializes without errors', () => {
		expect(() => {
			new Elysia().use(rbacPlugin(mockConfig));
		}).not.toThrow();
	});
});
