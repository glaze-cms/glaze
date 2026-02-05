/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { expect, test, describe } from 'bun:test';
import { deepMerge } from './merge';

interface TestConfig {
	a: number;
	config: {
		dark: boolean;
		volume?: number;
	};
}

describe('deepMerge', () => {
	test('should merge nested objects', () => {
		const target: TestConfig = { a: 1, config: { dark: true } };
		const source = { config: { dark: false, volume: 10 } };

		const result = deepMerge(target, source);

		expect(result).toEqual({ a: 1, config: { dark: false, volume: 10 } });
	});

	test('should not mutate the original target object', () => {
		const target = { a: 1, b: { c: 2 } };
		const source = { b: { c: 3 } };

		const result = deepMerge(target, source);

		expect(target.b.c).toBe(2); // Original stays same
		expect(result.b.c).toBe(3); // Result is updated
	});

	test('should handle source being null or undefined', () => {
		const target = { a: 1 };
		expect(deepMerge(target, undefined)).toEqual({ a: 1 });
		// @ts-expect-error - testing runtime resilience
		expect(deepMerge(target, null)).toEqual({ a: 1 });
	});

	test('should handle source having extra keys not in target', () => {
		const target = { a: 1 };
		const source = { b: 2 } as any;

		const result = deepMerge(target, source);

		expect(result as any).toEqual({ a: 1, b: 2 });
	});

	test('should completely replace arrays (not merge them)', () => {
		const target = { list: [1, 2] };
		const source = { list: [3] };

		const result = deepMerge(target, source);

		expect(result.list).toEqual([3]);
		expect(result.list).not.toBe(source.list);
	});

	test('should handle deep nested overrides', () => {
		const target = { levels: { l1: { l2: { val: 'old' } } } };
		const source = { levels: { l1: { l2: { val: 'new' } } } };

		const result = deepMerge(target, source);
		expect(result.levels.l1.l2.val).toBe('new');
	});

	test('should ignore undefined values in source', () => {
		const target = { a: 1, b: 2 };
		const source = { a: undefined, b: 3 };

		const result = deepMerge(target, source);

		// a should stay 1 because source.a was undefined
		expect(result).toEqual({ a: 1, b: 3 });
	});
});
