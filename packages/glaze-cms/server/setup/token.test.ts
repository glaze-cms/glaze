import { expect, test } from '#harness';

import { isSetupTokenValid } from './token.ts';

test('a token matches only itself', () => {
	expect(isSetupTokenValid('correct-horse-battery-staple', 'correct-horse-battery-staple')).toBe(
		true,
	);
	// Same length, one character off — the case a length check alone would wave through.
	expect(isSetupTokenValid('correct-horse-battery-stapLe', 'correct-horse-battery-staple')).toBe(
		false,
	);
	expect(isSetupTokenValid('correct-horse-battery-stapl', 'correct-horse-battery-staple')).toBe(
		false,
	);
	expect(isSetupTokenValid('', 'correct-horse-battery-staple')).toBe(false);
	expect(isSetupTokenValid(null, 'correct-horse-battery-staple')).toBe(false);
});
