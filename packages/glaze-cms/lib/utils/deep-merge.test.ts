import { expect, test } from '#harness';

import { deepMerge } from './deep-merge.ts';

test('deep-merges nested objects, keeping keys from both sides', () => {
	const merged = deepMerge<Record<string, unknown>>(
		{ a: 1, nested: { x: 1 } },
		{ nested: { y: 2 } },
	);
	expect(merged).toEqual({ a: 1, nested: { x: 1, y: 2 } });
});

test('a source scalar overrides the target scalar', () => {
	const merged = deepMerge({ port: 4000, host: 'a' }, { port: 8080 });
	expect(merged).toEqual({ port: 8080, host: 'a' });
});

test('an undefined source value never clobbers a defined default', () => {
	// A user object typed with an optional field can still hold an explicit `undefined` at runtime.
	const merged = deepMerge<{ port: number }>({ port: 4000 }, {
		port: undefined,
	} as unknown as Partial<{ port: number }>);
	expect(merged.port).toBe(4000);
});

test('a null source value DOES override (null is a defined choice, not absence)', () => {
	const merged = deepMerge({ token: 'abc' }, { token: null } as unknown as { token: string });
	expect(merged.token).toBeNull();
});

test('arrays are replaced wholesale, not merged element-wise', () => {
	const merged = deepMerge({ methods: ['GET', 'POST'] }, { methods: ['GET'] });
	expect(merged.methods).toEqual(['GET']);
});

test('replaced arrays are cloned — mutating the result does not touch the source', () => {
	const source = { methods: ['GET'] };
	const merged = deepMerge({ methods: ['POST'] }, source);
	merged.methods.push('PUT');
	expect(source.methods).toEqual(['GET']);
});

test('a non-plain object (Date) replaces rather than deep-merging into it', () => {
	const when = new Date('2020-01-01T00:00:00Z');
	const merged = deepMerge({ at: new Date('1999-01-01T00:00:00Z') }, { at: when });
	expect(merged.at).toBe(when);
});

test('returns the target unchanged when the source is omitted', () => {
	const target = { a: 1 };
	expect(deepMerge(target)).toEqual({ a: 1 });
});

test('ignores __proto__ so a crafted source cannot pollute Object.prototype', () => {
	const malicious = JSON.parse('{ "__proto__": { "polluted": true } }') as Record<string, unknown>;
	const merged = deepMerge<Record<string, unknown>>({ safe: true }, malicious);

	// Neither the result nor the global prototype gained the injected property.
	expect(merged['polluted']).toBe(undefined);
	expect(({} as Record<string, unknown>)['polluted']).toBe(undefined);
	expect(merged.safe).toBe(true);
});

test('ignores a constructor key so merging cannot overwrite it', () => {
	const malicious = JSON.parse('{ "constructor": { "polluted": true } }') as Record<
		string,
		unknown
	>;
	const merged = deepMerge<Record<string, unknown>>({ safe: true }, malicious);
	expect(merged.constructor).toBe(Object);
});
