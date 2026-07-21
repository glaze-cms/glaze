import { spawn as spawnChild } from 'node:child_process';
import { mkdir, readFile as readFileNode, writeFile as writeFileNode } from 'node:fs/promises';
import { dirname } from 'node:path';

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
 * Writes a UTF-8 file using `node:fs/promises`, creating parent directories first for parity with
 * `Bun.write` (which auto-creates them).
 * @param path - The file path.
 * @param contents - The string to write.
 */
async function writeFile(path: string, contents: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
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

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		// Collect raw Buffers and decode once: `String(chunk)` per `data` event corrupts a multibyte
		// UTF-8 sequence split across chunk boundaries (which would then break `JSON.parse`).
		child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
		child.on('error', reject);
		// A signal-killed process reports `code === null`; treat it as failure (non-zero), not success.
		child.on('close', (code) =>
			resolve({
				exitCode: code ?? 1,
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
			}),
		);
	});
}

/** The Node runtime adapter — uses `node:fs`/`node:child_process`. */
export const nodeRuntime: Runtime = {
	name: 'node',
	readFile,
	writeFile,
	spawn,
};
