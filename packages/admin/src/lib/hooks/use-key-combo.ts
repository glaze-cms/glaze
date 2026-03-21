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
 * @example
 * // Fires on ⌘B (Mac) or Ctrl+B (Win/Linux)
 * useKeyCombo({ key: 'b', meta: true, ctrl: true }, () => setIsOpen(v => !v));
 */
export function useKeyCombo(combo: KeyCombo, callback: () => void) {
	const { key, meta, ctrl } = combo;

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== key) return;
			if ((meta || ctrl) && !(e.metaKey || e.ctrlKey)) return;
			e.preventDefault();
			callback();
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [key, meta, ctrl, callback]);
}
