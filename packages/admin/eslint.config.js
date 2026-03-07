import rootConfig from '../../eslint.config.js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
	...rootConfig,
	{
		files: ['**/*.{ts,tsx}'],
		plugins: {
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
		},
		languageOptions: {
			globals: globals.browser,
			parserOptions: {
				project: ['./tsconfig.app.json', './tsconfig.node.json'],
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			'react-refresh/only-export-components': 'off',
			'@typescript-eslint/no-misused-promises': 'off',
		},
	},
];
