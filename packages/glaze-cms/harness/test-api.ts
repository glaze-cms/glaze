/**
 * Cross-runtime test API. The matrix specs run under BOTH `bun test` (Bun) and `node --test`
 * (Node) — that runtime split is the whole point of the matrix — so specs must not import
 * `bun:test` directly. This exposes a minimal `test` (+ `skipIf`) and `expect` backed by `bun:test`
 * on Bun and `node:test` + `node:assert` on Node, covering exactly the matcher surface the specs use.
 */

// This file is cross-runtime glue: it bridges two test backends whose types differ, so `unknown`→T
// boundary casts are unavoidable. tsc requires them; tsgolint reports them as unnecessary. The rule
// is off for this file only.
// oxlint-disable no-unnecessary-type-assertion

/** A test body. */
type TestBody = () => void | Promise<void>;

/** The registrar returned by {@link TestApi.skipIf}; accepts an optional per-test timeout (ms). */
type SkipIfRegistrar = (name: string, body: TestBody, timeout?: number) => void;

/** The `test` function plus the `skipIf` helper the matrix harness uses. */
export interface TestApi {
	(name: string, body: TestBody): void;
	/** Registers a test that is skipped (loudly) when `condition` is true. */
	skipIf(condition: boolean): SkipIfRegistrar;
}

/** The subset of matcher methods the specs use. */
export interface Expectation {
	toBe(expected: unknown): void;
	toEqual(expected: unknown): void;
	toHaveLength(length: number): void;
	toBeNull(): void;
	toContain(item: unknown): void;
	toThrow(): void;
}

/** The `expect` entry point. */
export type Expect = (actual: unknown) => Expectation;

/** The `node:assert/strict` surface used by the Node-backed `expect`. */
interface StrictAssert {
	strictEqual(actual: unknown, expected: unknown): void;
	deepStrictEqual(actual: unknown, expected: unknown): void;
	ok(value: unknown): void;
	throws(fn: () => unknown): void;
}

/** The `node:test` `test` surface used here (name + optional options + body). */
type NodeTest = {
	(name: string, body: TestBody): unknown;
	(name: string, options: { skip?: boolean; timeout?: number }, body: TestBody): unknown;
};

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

/**
 * Builds the Node-backed `expect` over `node:assert/strict`.
 *
 * @param assert - The strict assert module.
 * @returns An `expect` implementation.
 */
function nodeExpect(assert: StrictAssert): Expect {
	return (actual) => ({
		toBe: (expected) => assert.strictEqual(actual, expected),
		toEqual: (expected) => assert.deepStrictEqual(actual, expected),
		toHaveLength: (length) => assert.strictEqual((actual as { length: number }).length, length),
		toBeNull: () => assert.strictEqual(actual, null),
		toContain: (item) =>
			assert.ok((actual as ReadonlyArray<unknown> | string).includes(item as never)),
		toThrow: () => assert.throws(actual as () => unknown),
	});
}

/**
 * Adapts `node:test` into the {@link TestApi} shape (adds `skipIf`, forwards the timeout option).
 *
 * @param nodeTest - The `node:test` `test` function.
 * @returns A {@link TestApi}.
 */
function nodeTestApi(nodeTest: NodeTest): TestApi {
	const api = ((name: string, body: TestBody) => {
		void nodeTest(name, body);
	}) as TestApi;

	api.skipIf = (condition) => (name, body, timeout) => {
		const options = timeout === undefined ? { skip: condition } : { skip: condition, timeout };
		void nodeTest(name, options, body);
	};

	return api;
}

let test: TestApi;
let expect: Expect;

if (isBun) {
	const bunTest = await import('bun:test');
	test = bunTest.test as unknown as TestApi;
	expect = bunTest.expect as unknown as Expect;
} else {
	const nodeTestModule = await import('node:test');
	const assertModule = await import('node:assert/strict');
	test = nodeTestApi(nodeTestModule.test as unknown as NodeTest);
	expect = nodeExpect(assertModule.default as unknown as StrictAssert);
}

export { expect, test };
