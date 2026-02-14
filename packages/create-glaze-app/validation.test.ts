import { describe, expect, test } from 'bun:test';
import { validateProjectName } from './validation';

describe('validateProjectName', () => {
	test('rejects empty string', () => {
		expect(validateProjectName('')).toBe('Please enter a directory name.');
	});

	test('rejects whitespace-only string', () => {
		expect(validateProjectName('   ')).toBe(
			'Please enter a directory name.',
		);
	});

	test('rejects undefined (default param)', () => {
		expect(validateProjectName()).toBe('Please enter a directory name.');
	});

	test('rejects absolute path', () => {
		expect(validateProjectName('/foo/bar')).toBe(
			'Please use a folder name like "my-glaze-app", not a full path.',
		);
	});

	test('rejects absolute path with nested dirs', () => {
		expect(validateProjectName('/a/b/my-app')).toBe(
			'Please use a folder name like "my-glaze-app", not a full path.',
		);
	});

	test('rejects ".." traversal', () => {
		expect(validateProjectName('../my-app')).toBe(
			'Please use a folder name like "my-glaze-app" without ".." segments.',
		);
	});

	test('rejects nested ".." traversal', () => {
		expect(validateProjectName('a/../../my-app')).toBe(
			'Please use a folder name like "my-glaze-app" without ".." segments.',
		);
	});

	test('rejects bare ".."', () => {
		expect(validateProjectName('..')).toBe(
			'Please use a folder name like "my-glaze-app" without ".." segments.',
		);
	});

	test('rejects bare "."', () => {
		expect(validateProjectName('.')).toBe(
			'Please use a folder name like "my-glaze-app" without ".." segments.',
		);
	});

	test('accepts simple folder name', () => {
		expect(validateProjectName('my-app')).toBeUndefined();
	});

	test('accepts nested relative path', () => {
		expect(validateProjectName('a/b/my-app')).toBeUndefined();
	});

	test('accepts dot-relative path', () => {
		expect(validateProjectName('./my-app')).toBeUndefined();
	});
});
