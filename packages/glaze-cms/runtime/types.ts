/** The runtime Glaze is executing on. */
export type RuntimeName = 'bun' | 'node';

/** Options for spawning a subprocess. */
export interface SpawnOptions {
	/** Working directory for the child process. */
	cwd?: string;
	/** Environment variables for the child process. */
	env?: Record<string, string | undefined>;
}

/** The result of running a subprocess to completion. */
export interface SpawnResult {
	/** The process exit code (`0` on success). */
	exitCode: number;
	/** Everything the process wrote to stdout. */
	stdout: string;
	/** Everything the process wrote to stderr. */
	stderr: string;
}

/**
 * The runtime seam: the narrow set of primitives that differ in performance/availability
 * between Bun and Node — file I/O and process spawning. Resolved once at the composition root
 * and injected inward so logic never branches on the runtime (see CLAUDE.md §5).
 *
 * The HTTP-server adapter is intentionally absent: Elysia owns that seam (`adapter: node()`).
 */
export interface Runtime {
	/** Which runtime this adapter implements. */
	readonly name: RuntimeName;
	/**
	 * Reads a UTF-8 file.
	 * @param path - Absolute or cwd-relative file path.
	 * @returns The file contents as a string.
	 */
	readFile(path: string): Promise<string>;
	/**
	 * Reads a file as raw bytes (for serving binary assets like fonts/images without corrupting them).
	 * @param path - Absolute or cwd-relative file path.
	 * @returns The file contents as bytes.
	 */
	readBytes(path: string): Promise<Uint8Array>;
	/**
	 * Writes a UTF-8 file, creating or overwriting it.
	 * @param path - Absolute or cwd-relative file path.
	 * @param contents - The string to write.
	 */
	writeFile(path: string, contents: string): Promise<void>;
	/**
	 * Runs a subprocess to completion and captures its output.
	 * @param command - The command and its arguments (e.g. `['drizzle-kit', 'push']`).
	 * @param options - Optional working directory and environment.
	 * @returns The exit code and captured stdout/stderr.
	 */
	spawn(command: string[], options?: SpawnOptions): Promise<SpawnResult>;
}
