import type { Runtime, SpawnOptions, SpawnResult } from './types.ts';

/**
 * Reads a UTF-8 file using Bun's native `Bun.file`.
 * @param path - The file path.
 * @returns The file contents.
 */
async function readFile(path: string): Promise<string> {
	return Bun.file(path).text();
}

/**
 * Writes a UTF-8 file using Bun's native `Bun.write`.
 * @param path - The file path.
 * @param contents - The string to write.
 */
async function writeFile(path: string, contents: string): Promise<void> {
	await Bun.write(path, contents);
}

/**
 * Runs a subprocess with `Bun.spawn`, capturing stdout/stderr.
 * @param command - The command and its arguments.
 * @param options - Optional working directory and environment.
 * @returns The exit code and captured output.
 */
async function spawn(command: string[], options?: SpawnOptions): Promise<SpawnResult> {
	const proc = Bun.spawn(command, {
		...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
		// Merge over the current environment (parity with the Node adapter). Passing `options.env`
		// alone would make Bun REPLACE the child's environment, stripping PATH/creds.
		env: { ...process.env, ...options?.env },
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return { exitCode, stdout, stderr };
}

/** The Bun runtime adapter — uses native-fast Bun primitives. */
export const bunRuntime: Runtime = {
	name: 'bun',
	readFile,
	writeFile,
	spawn,
};
