import { styleText } from 'node:util';

/** Background colors cycled through when badging logger names. */
const BG_COLORS = ['bgBlue', 'bgGreen', 'bgYellow', 'bgMagenta', 'bgCyan', 'bgRed'] as const;

/**
 * Hashes a string to a stable non-negative integer, so a given logger name always maps to
 * the same color.
 *
 * @param value - The string to hash.
 * @returns A non-negative integer hash.
 */
function hashString(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index++) {
		hash = value.charCodeAt(index) + ((hash << 4) - hash);
	}
	return Math.abs(hash);
}

/**
 * Renders a logger name as a colored badge, with the color chosen deterministically from
 * the name so it stays consistent across log lines.
 *
 * @param name - The logger name to badge.
 * @returns The ANSI-styled name badge.
 */
export function getColoredName(name: string): string {
	const colorIndex = hashString(name) % BG_COLORS.length;
	const backgroundColor = BG_COLORS[colorIndex] as (typeof BG_COLORS)[number];
	return styleText([backgroundColor, 'white', 'bold'], ` ${name} `);
}

/**
 * Renders a log level in its conventional color (error → red, warn → yellow, info → green,
 * others uncolored).
 *
 * @param level - The log level name.
 * @returns The upper-cased, ANSI-styled level.
 */
export function getColoredLevel(level: string): string {
	const upperLevel = level.toUpperCase();
	const lowerLevel = level.toLowerCase();

	if (lowerLevel === 'error') return styleText('red', upperLevel);
	if (lowerLevel === 'warn') return styleText('yellow', upperLevel);
	if (lowerLevel === 'info') return styleText('green', upperLevel);
	return upperLevel;
}
