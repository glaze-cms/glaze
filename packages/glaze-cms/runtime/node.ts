import { spawn as spawnChild } from 'node:child_process';
import { readFile as readFileNode, writeFile as writeFileNode } from 'node:fs/promises';

import type { Runtime, SpawnOptions, SpawnResult } from './types.ts';

/**
 * Reads a UTF-8 file using `node:fs/promises`.
 * @param path - The file path.
 * @returns The file contents.
 */
async function readFile(path: string): Promise<string> {
	return readFileNode(path, 'utf8');
}

/**
 * Writes a UTF-8 file using `node:fs/promises`.
 * @param path - The file path.
 * @param contents - The string to write.
 */
async function writeFile(path: string, contents: string): Promise<void> {
	await writeFileNode(path, contents);
}

/**
 * Runs a subprocess with `node:child_process`, capturing stdout/stderr.
 * @param command - The command and its arguments.
 * @param options - Optional working directory and environment.
 * @returns The exit code and captured output.
 */
function spawn(command: string[], options?: SpawnOptions): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const [file, ...args] = command;
		if (!file) {
			reject(new Error('spawn requires at least a command name'));
			return;
		}

		const child = spawnChild(file, args, {
			cwd: options?.cwd,
			env: { ...process.env, ...options?.env },
		});

		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
		child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
		child.on('error', reject);
		child.on('close', (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
	});
}

/** The Node runtime adapter — uses `node:fs`/`node:child_process`. */
export const nodeRuntime: Runtime = {
	name: 'node',
	readFile,
	writeFile,
	spawn,
};
