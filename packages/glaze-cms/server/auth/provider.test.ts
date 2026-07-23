import { expect, test } from '#harness';

import { resolveAuthProvider } from './provider.ts';

test('resolveAuthProvider maps Glaze dialects onto Better Auth providers', () => {
	expect(resolveAuthProvider('postgres')).toBe('pg');
	expect(resolveAuthProvider('sqlite')).toBe('sqlite');
});
