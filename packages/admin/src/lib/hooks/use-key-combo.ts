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
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const modifierMatch =
				(combo.meta ?? combo.ctrl) && (e.metaKey || e.ctrlKey);
			if (modifierMatch && e.key === combo.key) {
				e.preventDefault();
				callback();
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [combo, callback]);
}
