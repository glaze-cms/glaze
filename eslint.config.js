import eslint from '@eslint/js';
import { configs } from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';

export default [
	{
		ignores: ['build/', 'dist/', 'node_modules/', '**/*.d.ts'],
	},

	eslint.configs.recommended,
	prettierConfig,

	...configs.strictTypeChecked,

	{
		files: ['**/*.{ts,tsx}'],
		plugins: {
			import: importPlugin,
		},
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				project: ['./tsconfig.json', './packages/*/tsconfig.json'],
				ecmaFeatures: {
					jsx: true,
				},
			},
			globals: {
				console: 'readonly',
				process: 'readonly',
				Bun: 'readonly',
				NodeJS: 'readonly',
			},
		},
		settings: {
			'import/resolver': {
				typescript: {
					project: ['./tsconfig.json', './packages/*/tsconfig.json'],
					alwaysTryTypes: true,
				},
			},
		},

		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/prefer-nullish-coalescing': 'warn',

			'consistent-return': 'warn',
			'no-console': 'warn',
			'no-duplicate-imports': 'error',
		},
	},

	{
		files: ['**/logger.ts'],
		rules: {
			'no-console': 'off',
		},
	},

	{
		files: ['**/*.ts', '**/*.tsx'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@glaze/*/*'],
							message:
								'Use package-level imports only, except for explicitly exported subpaths.',
						},
					],
					allow: ['@glaze/core/server/types'],
				},
			],
		},
	},
];
