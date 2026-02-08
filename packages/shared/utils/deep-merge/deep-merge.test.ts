/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { expect, test, describe } from 'bun:test';
import { deepMerge } from './deep-merge';

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

	describe('prototype pollution prevention', () => {
		test('should skip __proto__ keys', () => {
			const target = { a: 1 };
			const source = JSON.parse('{"__proto__": {"polluted": true}, "b": 2}');

			const result = deepMerge(target, source);

			expect((result as any).b).toBe(2);
			expect((result as any).polluted).toBeUndefined();
			// Ensure Object prototype is not polluted
			expect(({} as any).polluted).toBeUndefined();
		});

		test('should skip constructor keys', () => {
			const target = { a: 1 };
			const source = { constructor: { polluted: true } } as any;

			const result = deepMerge(target, source);

			// constructor should not be overwritten
			expect(result.constructor).toBe(Object);
		});

		test('should skip prototype keys', () => {
			const target = { a: 1 };
			const source = { prototype: { polluted: true } } as any;

			const result = deepMerge(target, source);

			expect((result as any).prototype).toBeUndefined();
		});
	});

	describe('edge cases', () => {
		test('should not merge non-plain objects (Date)', () => {
			const date = new Date('2024-01-01');
			const target = { date: new Date('2023-01-01') };
			const source = { date };

			const result = deepMerge(target, source);

			// Date should be replaced, not recursively merged
			expect(result.date).toBe(date);
		});

		test('should not merge non-plain objects (RegExp)', () => {
			const regex = /test/i;
			const target = { pattern: /old/ };
			const source = { pattern: regex };

			const result = deepMerge(target, source);

			expect(result.pattern).toBe(regex);
		});

		test('should handle empty source object', () => {
			const target = { a: 1, b: 2 };
			const result = deepMerge(target, {});
			expect(result).toEqual({ a: 1, b: 2 });
		});

		test('should handle empty target object', () => {
			const target = {} as { a?: number };
			const source = { a: 1 };
			const result = deepMerge(target, source);
			expect(result).toEqual({ a: 1 });
		});

		test('should return source when target is falsy', () => {
			const source = { a: 1 };
			// @ts-expect-error - testing runtime resilience
			expect(deepMerge(null, source)).toEqual({ a: 1 });
		});
	});
});
