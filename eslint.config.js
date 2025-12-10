import eslint from '@eslint/js';
import { configs } from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default [
	// Base ignores
	{
		ignores: ['build/', 'dist/', 'node_modules/', '**/*.d.ts'],
	},

	// Base recommended rules
	eslint.configs.recommended,
	prettierConfig,

	...configs.strictTypeChecked,

	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				project: [
					'./tsconfig.json',
					'./apps/*/tsconfig.json',
					'./packages/*/tsconfig.json',
				],
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
					project: './tsconfig.json',
				},
			},
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_' },
			],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/prefer-nullish-coalescing': 'error',

			'consistent-return': 'warn',
			'no-await-in-loop': 'warn',
			'no-console': 'warn',
			'no-duplicate-imports': 'error',
		},
	},

	{
		files: ['**/*.js'],
		...configs.disableTypeChecked,
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: {
				console: 'readonly',
				process: 'readonly',
				require: 'readonly',
				module: 'readonly',
				exports: 'readonly',
				__dirname: 'readonly',
				__filename: 'readonly',
				Buffer: 'readonly',
				global: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
			},
		},
	},
	{
		files: ['**/logger.ts'],
		rules: {
			'no-console': 'off',
		},
	},
];
