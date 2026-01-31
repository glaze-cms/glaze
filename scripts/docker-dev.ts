#!/usr/bin/env bun

import { spawnSync } from 'bun';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = resolve(__dirname, '..');
const args = process.argv.slice(2);

const result = spawnSync(
	[
		'docker',
		'compose',
		'-f',
		'packages/development/docker-compose.yml',
		'up',
		'-d',
		...args,
	],
	{
		cwd: ROOT_DIR,
		stdio: ['inherit', 'inherit', 'inherit'],
	},
);

if (result.exitCode !== 0) {
	process.exit(result.exitCode);
}
