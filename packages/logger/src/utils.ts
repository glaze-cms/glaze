import { styleText } from 'node:util';

/**
 * Background colors for logger names
 */
const BG_COLORS = [
	'bgBlue',
	'bgGreen',
	'bgMagenta',
	'bgCyan',
	'bgYellow',
	'bgRed',
] as const;

/**
 * Simple hash function to consistently map logger names to colors
 */
function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i) + ((hash << 4) - hash);
	}
	return Math.abs(hash);
}

/**
 * Get a colored background for a logger name
 */
export function getColoredName(name: string): string {
	const colorIndex = hashString(name) % BG_COLORS.length;
	const bgColor = BG_COLORS[colorIndex];
	return styleText(
		[bgColor as (typeof BG_COLORS)[number], 'white', 'bold'],
		` ${name} `,
	);
}

/**
 * Get a colored log level
 * - ERROR: red
 * - WARN: yellow
 * - INFO: green
 * - Others: white
 */
export function getColoredLevel(level: string): string {
	const upperLevel = level.toUpperCase();
	const lowerLevel = level.toLowerCase();

	if (lowerLevel === 'error') {
		return styleText('red', upperLevel);
	}
	if (lowerLevel === 'warn') {
		return styleText('yellow', upperLevel);
	}
	if (lowerLevel === 'info') {
		return styleText('green', upperLevel);
	}
	return upperLevel;
}
