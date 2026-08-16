import { useEffect } from 'react';

interface KeyCombo {
	/** The keyboard key to listen for (e.g. `'b'`, `'s'`, `'Escape'`). Case-sensitive — use lowercase for letter keys. */
	key: string;
	/** Require the Command key (Mac) or Windows key. Combines with `ctrl` so either modifier triggers the combo cross-platform. */
	meta?: boolean;
	/** Require the Control key. Combines with `meta` so either modifier triggers the combo cross-platform. */
	ctrl?: boolean;
}

/**
 * Listens for a keyboard shortcut globally and calls `callback` when matched.
 *
 * @param combo - The key and modifiers to match.
 * @param callback - Called when the combo fires. Memoize it, or the listener is rebound every render.
 *
 * @example
 * // Fires on ⌘B (Mac) or Ctrl+B (Win/Linux)
 * useKeyCombo({ key: 'b', meta: true, ctrl: true }, () => setIsOpen((v) => !v));
 */
export function useKeyCombo(combo: KeyCombo, callback: () => void): void {
	const { key, meta, ctrl } = combo;

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key !== key) return;
			if ((meta || ctrl) && !(event.metaKey || event.ctrlKey)) return;
			event.preventDefault();
			callback();
		}

		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [key, meta, ctrl, callback]);
}
