import { describe, it, expect } from 'bun:test';
import { getColoredLevel, getColoredName } from './utils';

describe('getColoredLevel', () => {
	it('should color ERROR as red', () => {
		const result = getColoredLevel('error');
		expect(result).toContain('ERROR');
		// Contains ANSI red color code
		expect(result).toContain('\x1b[31m');
	});

	it('should color WARN as yellow', () => {
		const result = getColoredLevel('warn');
		expect(result).toContain('WARN');
		// Contains ANSI yellow color code
		expect(result).toContain('\x1b[33m');
	});

	it('should color INFO as green', () => {
		const result = getColoredLevel('info');
		expect(result).toContain('INFO');
		// Contains ANSI green color code
		expect(result).toContain('\x1b[32m');
	});

	it('should return uppercase without color for other levels', () => {
		const result = getColoredLevel('debug');
		expect(result).toBe('DEBUG');
		// Should not contain any ANSI color codes
		expect(result).not.toContain('\x1b[');
	});

	it('should handle mixed case input', () => {
		expect(getColoredLevel('ErRoR')).toContain('ERROR');
		expect(getColoredLevel('WaRn')).toContain('WARN');
		expect(getColoredLevel('InFo')).toContain('INFO');
	});
});

describe('getColoredName', () => {
	it('should return a colored name with background', () => {
		const result = getColoredName('test-logger');
		expect(result).toContain('test-logger');
		// Should contain ANSI escape codes for background color
		expect(result).toContain('\x1b[');
	});

	it('should consistently color the same name', () => {
		const result1 = getColoredName('my-logger');
		const result2 = getColoredName('my-logger');
		expect(result1).toBe(result2);
	});

	it('should color different names differently (probabilistic)', () => {
		const names = ['logger1', 'logger2', 'logger3', 'logger4', 'logger5'];
		const coloredNames = names.map((name) => getColoredName(name));

		// At least some should be different colors
		// (Not guaranteed but highly likely with 5 names and 6 colors)
		const uniqueColors = new Set(coloredNames);
		expect(uniqueColors.size).toBeGreaterThan(1);
	});

	it('should add padding around the name', () => {
		const result = getColoredName('test');
		// Should have spaces around the name
		expect(result).toContain(' test ');
	});
});
