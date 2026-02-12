# Filesystem Best Practices for Node.js / Bun Coding Agents

## Goal

Write filesystem code that is:

- Memory efficient
- Race-condition safe
- Syscall minimal
- OS-optimized
- Production safe by default

---

## Core Principles

### 1. Read Only The Bytes You Need

**Rule:** Never read an entire file if you only need part of it.

#### ❌ Bad

```ts
readFileSync(path).slice(0, max);
```

**Problems**

- Loads entire file into memory
- Slice keeps original buffer/string alive
- Catastrophic for large files

#### ✅ Good — Partial Read

```ts
import { openSync, readSync, closeSync } from 'node:fs';

const fd = openSync(path, 'r');
const buffer = Buffer.alloc(max);

readSync(fd, buffer, 0, max, 0);

closeSync(fd);
```

#### ✅ Good — Streaming

```ts
createReadStream(path, { start: 0, end: max - 1 });
```

---

### 2. Never Check If Something Exists Before Acting On It

**Rule:** Do not use `existsSync` or equivalent pre-checks.

#### ❌ Bad

```ts
if (existsSync(path)) {
	statSync(path);
}
```

**Problems**

- Extra syscall (slow)
- Race condition (TOCTOU)
- Still crashes if file disappears between calls

#### ✅ Good — Try And Handle Error

```ts
try {
	const stat = statSync(path);
} catch (err) {
	if (err.code === 'ENOENT') {
		// File does not exist — expected case
	} else {
		throw err;
	}
}
```

**Mental Model**

```text
Attempt operation → Handle failure
NOT
Check → Attempt → Hope nothing changed
```

---

### 3. Never Manually Implement Recursive File Operations

**Rule:** Use built-in recursive OS-backed operations.

#### ❌ Bad

```ts
readdirSync(path).map((file) => unlinkSync(file));
```

**Problems**

- Breaks on nested directories
- Breaks on symlinks
- Slow (many syscalls)
- Easy to get wrong

#### ✅ Good

```ts
rmSync(path, { recursive: true, force: true });
```

---

## Performance Rules

### Prefer Single High-Level Operations

Use:

```ts
rm(path, { recursive: true, force: true });
mkdir(path, { recursive: true });
cp(src, dest, { recursive: true });
```

Avoid:

- Manual directory walking
- Manual recursive deletion
- Manual copy loops

---

## Memory Safety Rules

Agents MUST avoid:

```text
readFile().slice()
readFileSync().slice()
readFile() when file size is unknown and potentially large
```

Agents SHOULD prefer:

- Streams
- Partial reads
- File descriptors for range reads

---

## Race Condition Awareness

Agents must assume:

- Files can disappear anytime
- Permissions can change anytime
- Other processes may modify the filesystem concurrently

Safe pattern:

```ts
try {
	// Do operation
} catch (err) {
	// Handle expected failure modes
}
```

---

## Syscall Efficiency Rules

### Avoid Double Filesystem Calls

If you see patterns like:

```text
exists → stat
exists → read
exists → delete
```

Replace with:

```text
attempt → catch error
```

---

## Default Error Handling Pattern

```ts
try {
	// filesystem operation
} catch (err) {
	switch (err.code) {
		case 'ENOENT':
			// not found
			break;
		case 'EACCES':
		case 'EPERM':
			// permission issue
			break;
		default:
			throw err;
	}
}
```

---

## Red Flag Anti-Patterns (Auto-Reject In Reviews)

### Memory

```text
readFile().slice()
readFileSync().slice()
```

### Race Conditions

```text
existsSync() before any other fs operation
```

### Reinventing OS Features

```text
manual recursive delete
manual recursive copy
manual mkdir chains
```

---

## Golden Rules (Short Form)

1. Never read more bytes than you will use.
2. Never check existence before performing an operation.
3. Prefer one OS-level call over many manual calls.
4. Always assume the filesystem is changing underneath you.
5. Errors are part of control flow in filesystem code.

---

## Agent Decision Heuristics

If file size is unknown:
→ Use stream or partial read

If about to use `exists*`:
→ Remove it, handle error instead

If about to loop files for deletion:
→ Use `rm({ recursive: true })`

If writing more than ~10 lines of filesystem traversal:
→ There is probably a built-in API that is better

---

## Bun Compatibility Notes

These rules apply equally to:

- Node.js
- Bun
- Deno (conceptually)

Bun often makes high-level operations even faster, making manual implementations even less justified.
