# Design — `create-glaze-app` scaffolder

> **Status: DEFERRED to launch — 2026-08-16.** Tracked as **LEA-18**. This document is a completed design
> pass kept so the work is never re-derived. Nothing here has been built.

## Why it is deferred

The scaffolder is **not blocked by the team/audit flow**, which is the intuitive assumption. Its only
contact with that flow is one line, `workflow: { mode: 'solo' }`; when the pending ledger lands, the change
is turning a constant into a prompt.

It is blocked by **distribution**. The scaffolder exists to onboard people who aren't the maintainer, and
nobody can install `glaze-cms` today: it is not on npm, and bun does not support subdirectory git
dependencies, so `github:glaze-cms/glaze` can never resolve `packages/glaze-cms`. The whole design routes
around that with a `--link` flag pointing at a local checkout — which is not onboarding. Meanwhile
`examples/blog` already covers local development, so building now would add a second source of truth for
"what a Glaze app looks like" plus ~700 lines of templates to keep gate-green, for no present gain.

**Pick this up as part of the launch bundle:** npm publish → quickstart README → scaffolder.

## Context

CLAUDE.md §10 names `create-glaze-app` as the onboarding surface ("onboarding = marketing"). The intended
outcome, when built: `bun run packages/create-glaze-app/cli.ts my-app --link ../glaze-cms` produces a
project that installs, boots, converges its schema into a real SQLite file, and serves the admin — proven
by an automated test, not by hand.

## Distribution notes (verified 2026-08-16)

- npm names `create-glaze`, `create-glaze-app`, `glaze-cms`, `glaze-admin` were all **free**.
- **GitHub Packages is not viable** — its npm registry requires a token even for public packages, the same
  private-registry trap the previous implementation fell into.
- Workable pre-npm paths: a **GitHub Release tarball** (`bun pm pack` → attach the `.tgz` → depend on the
  release URL; no auth on a public repo, artifact byte-identical to a future `npm publish`), or a dist repo
  holding the package at its root.
- **Publish is rehearsable without Verdaccio:** `bun pm pack --destination`, then `bun add ./glaze-cms-0.0.0.tgz`
  in a temp dir installs exactly the published file set, catching missing-file and `exports` bugs. Pair with
  `publint` + `@arethetypeswrong/cli` per CLAUDE.md §10.

## Docs corrections owed (independent of this work)

CLAUDE.md §10 says `create-glaze-app` powers `bun create glaze` — it would power `bun create glaze-app`,
since `bun create <x>` resolves npm `create-<x>`. §10 also calls the published framework package `glaze`;
it is `glaze-cms`.

### Decisions already locked (do not re-litigate)

| Decision              | Value                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package name          | `create-glaze-app`                                                  | Maintainer's call. Command is `bun create glaze-app` (`bun create <x>` → npm `create-<x>`).                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Workflow              | **solo only, never prompted**                                       | `audit` is derived from mode ([runner.ts:29](packages/glaze-cms/server/convergence/runner.ts:29)); `team` currently pends **and rolls back** ([engine.ts:149](packages/glaze-cms/convergence/orchestrator/engine.ts:149)) because the pending ledger is deferred (`docs/convergence-design.md:120`). Scaffolding `team` would hand someone a project whose schema changes never apply.                                                                                                                                        |
| Prompts               | `@clack/prompts`, version `latest`                                  | Maintainer: unpin decision deferred until later in the dev cycle.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `glaze-cms` specifier | `--link <path>` → `link:<abs path>`                                 | Bun **does not support subdirectory git deps** (verified in bun docs), so `github:glaze-cms/glaze` can never reach `packages/glaze-cms`. One `PUBLISHED_SPECIFIER` const covers the future.                                                                                                                                                                                                                                                                                                                                   |
| Runtime               | **Portable, Bun-first** — `engines: { bun: '>=1.4', node: '>=24' }` | `bun create glaze-app` is the headline; `npm create glaze-app` quietly works (CLAUDE.md §3: Node is a quiet capability that removes an adoption objection). A scaffolder that hard-fails without Bun _is_ that objection. Node 24+ because the bin is `.ts` and relies on type-stripping — already proven by CI's `node --test "packages/glaze-cms/**/*.test.ts"`, which runs this repo's TypeScript directly thanks to `erasableSyntaxOnly: true` in the root tsconfig. Same floor as `glaze-cms`'s existing `engines.node`. |
| Tests                 | `bun:test` only                                                     | Root `test:node` glob stays `packages/glaze-cms/**`. Portability is covered by one spawn test that runs the bin under `node` explicitly — cheaper than a cross-runtime shim that can't be imported from `#harness` anyway.                                                                                                                                                                                                                                                                                                    |

### Docs correction to make in the same change

CLAUDE.md §10 has two stale facts: it says `create-glaze-app` powers **`bun create glaze`** (it powers
`bun create glaze-app`), and it calls the published framework package **`glaze`** (it is `glaze-cms`).
Fix both lines; also update `docs/handoff.md` §"What's next".

---

## Package layout — `packages/create-glaze-app/`

Flat noun-named files at package root (the CLI is ~700 lines; a tree of barrels would be worse to
navigate than named siblings). Split into folders only when a file grows long — CLAUDE.md §9.

```
package.json  tsconfig.json
cli.ts          ← bin target, shebang, exports runCli(); self-executes under import.meta.main
index.ts        ← BARREL ONLY (re-exports for tests / programmatic use)
parser.ts       parseArguments(argv)      + parser.test.ts
prompter.ts     promptMissingOptions(...)
resolver.ts     resolveOptions(argv)      ← facade: parse → validate → prompt
validation.ts   validateDirectory / validateConnection   + validation.test.ts
naming.ts       toPackageName(directory)  + naming.test.ts
secret.ts       createAuthSecret()        + secret.test.ts
templates.ts    loadTemplates(dialect)
planner.ts      planProjectFiles(options, templates)     + planner.test.ts
writer.ts       writeProject(directory, files)           + writer.test.ts
installer.ts    installDependencies / initRepository
reporter.ts     all user-facing output (clack)
cli.test.ts     ← end-to-end spawn
boot.test.ts    ← the oracle (env-gated)
templates/
  base/      server.ts  tsconfig.json  _gitignore
  sqlite/    glaze.config.ts  schema.ts
  postgres/  glaze.config.ts  schema.ts
```

**`index.ts` stays a pure barrel** (CLAUDE.md §9) — the bin points at the noun-named `cli.ts`.

`package.json`: `bin: { "create-glaze-app": "./cli.ts" }`, `engines: { bun: ">=1.4", node: ">=24" }`,
`dependencies: { "@clack/prompts": "latest" }`,
`devDependencies: { "glaze-cms": "workspace:*", "drizzle-orm": "1.0.0-rc.4" }` (needed so template `.ts`
files typecheck), `scripts: { typecheck: "tsc --noEmit" }`, `files` including `templates/**` and
`!**/*.test.ts`. `tsconfig.json` = `{ "extends": "../../tsconfig.json" }`.

### Portability rules (Bun-first, Node-capable)

The CLI writes 9 small files — not a hot path — so CLAUDE.md §5's native-fast argument doesn't apply and
**no runtime seam is needed**. `packages/glaze-cms/runtime/` is intra-package (`#runtime`, absent from
`exports`) and cannot be reused here regardless; do **not** duplicate it.

- **File I/O** — `node:fs/promises` (`readFile`, `writeFile`, `mkdir`, `readdir`, `access`). Identical
  behavior on both runtimes.
- **Args** — `node:util` `parseArgs`. **Crypto** — `crypto.getRandomValues` (global on both).
- **Spawn** — `node:child_process`. Never `Bun.$` with an interpolated `cd ${dir} &&` (the old CLI's
  shell-injection-shaped bug); always `{ cwd: directory }`.
- **Shebang** — `#!/usr/bin/env node`, so `npm create` / `npx` work. `bun create` executes the bin with Bun
  itself; **verify this at implementation time** by running the bin under both.
- **Package manager** — `installDependencies` detects `process.versions.bun` → `bun install`, else
  `npm install`. Report which one it used in the next-steps message.

---

## Template mechanism — real files, zero placeholders

The old implementation (`glaze-cms-old/packages/create-glaze-app/templates.ts`) held every template as an
inline JS string with literal `\t` escapes: unreadable, unlintable, untypecheckable. Do not repeat it.

The insight that makes on-disk templates work with **no interpolation machinery**: push all variability
into the two files that are generated in code anyway.

- **Static template files** — `server.ts`, `schema.ts`, `glaze.config.ts`, `tsconfig.json`, `_gitignore`.
  Every `.ts` template is valid, compilable TypeScript. Postgres reads `DATABASE_URL` from env rather than
  baking the URL into the config, so even `glaze.config.ts` needs no substitution.
- **Generated in code** — `package.json` (`JSON.stringify(obj, null, '\t') + '\n'`), `.env`, `.env.example`,
  `README.md`.

Consequences, all resolved:

- tsc / oxlint / oxfmt process the templates → **this is the guardrail, not a problem**: a template that
  drifts from the framework API fails the gate. Requires the `glaze-cms` + `drizzle-orm` devDeps above.
- `.gitignore` ships as `_gitignore` (npm strips `.gitignore` from tarballs; a nested one would also affect
  this repo's own git). Renamed on write. Extension-less ⇒ ignored by oxfmt/oxlint/tsc.

```ts
/** The static template files for one dialect, already read from disk. */
export interface TemplateSet {
	readonly serverEntry: string;
	readonly glazeConfig: string;
	readonly schema: string;
	readonly tsconfig: string;
	readonly gitignore: string;
}

/**
 * Reads the on-disk template files for a dialect.
 * @param dialect - The database dialect the project targets.
 * @returns The template contents, keyed by role.
 * @throws {Error} When a template file is missing from the installed package.
 */
export async function loadTemplates(dialect: Dialect): Promise<TemplateSet>;
```

Resolve with `join(import.meta.dirname, 'templates', …)` (works from source and from an install); read with
`readFile(path, 'utf8')` from `node:fs/promises`.

---

## CLI surface

```
bun create glaze-app [directory] [options]

  --dialect <sqlite|postgres>   default: sqlite
  --connection <url>            postgres connection string
  --link <path>                 use a local glaze-cms checkout
  -y, --yes                     non-interactive
      --no-install / --no-git   skip bun install / git init
      --force                   allow a non-empty target directory
  -h, --help    -v, --version
```

`parser.ts` uses `node:util` `parseArgs` (`strict: true, allowPositionals: true`) so unknown flags fail loudly.

```ts
export type ParsedArguments =
	| { readonly kind: 'run'; readonly values: PartialOptions }
	| { readonly kind: 'help' }
	| { readonly kind: 'version' }
	| { readonly kind: 'error'; readonly message: string };

export function parseArguments(argv: readonly string[]): ParsedArguments;

export type ResolveOptionsResult =
	| { readonly kind: 'run'; readonly options: ScaffoldOptions }
	| { readonly kind: 'exit'; readonly code: number };

export async function resolveOptions(argv: readonly string[]): Promise<ResolveOptionsResult>;
```

**Interactivity rule** (mirrors `packages/glaze-cms/convergence/interactive/resolver.ts:215`): non-interactive
when `--yes`, or `!process.stdout.isTTY`, or `CI` / `GLAZE_NO_TTY` set. This is what makes the CLI
end-to-end testable — spawned tests inherit no TTY and can never hang. The old CLI had no such mode, which
is exactly why its entry point was untested.

**At most three prompts**, each with a `p.isCancel` guard → `p.cancel('Cancelled.')` → exit 0:

1. `p.text` "Where should your app be created?" — skipped when a positional dir was given. Default `my-glaze-app`.
2. `p.select` "Which database?" — `sqlite` ("zero setup — a local file", initial) / `postgres`. Skipped when `--dialect` given.
3. `p.text` "Postgres connection string" — only when postgres and `--connection` absent.

Deterministic non-interactive failures: `--yes --dialect postgres` without `--connection` → exit 1;
no `--link` while unpublished → exit 1 printing the exact `--link` invocation (better than emitting an
uninstallable `package.json`).

### Validation

```ts
/** @returns An error message, or `undefined` when valid. */
export function validateDirectory(value?: string): string | undefined;
export function validateConnection(value?: string): string | undefined;
export function toPackageName(directory: string): string;
```

- **Directory** — reject empty/whitespace, absolute paths, any `..` _segment_ (split `normalize(value)` on
  `sep`; the old `includes('..')` wrongly rejected a legitimate `my..app`), `node_modules`, NUL/newlines.
  **Allow `.`** (scaffold into cwd) — the old CLI rejected it.
- **Connection** — reject non-`postgres://`/`postgresql://` schemes, **any `\r`/`\n`** (the `.env`
  line-injection guard; this is the reason the function exists), and a missing host (`new URL()` in
  try/catch, require `hostname`).
- **Package name derived separately from the directory** — the old CLI used the raw prompt value, so
  `a/b/my-app` produced an invalid manifest. `basename` → lowercase → strip leading `.`/`_` → non-`[a-z0-9-~]`
  → `-` → collapse/trim → cap 214 → fallback `glaze-app`.

---

## Emitted project — 9 files

`package.json` · `tsconfig.json` · `glaze.config.ts` · `schema.ts` · `server.ts` · `.gitignore` · `.env` ·
`.env.example` · `README.md`

No `drizzle/` (convergence creates it) and **no `drizzle.config.ts`** — CLAUDE.md §4 deleted that juggling.

Modelled directly on [examples/blog](examples/blog): same `dev`/`start` scripts, same `authors` + `posts`
schema (keeping them identical enables the drift test below), `server.ts` is just `await glaze();`.

| File              | sqlite                                            | postgres                                               |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `glaze.config.ts` | `connection: './app.db'`                          | `connection` from `DATABASE_URL` with a throwing guard |
| `schema.ts`       | `sqliteTable` (copy of `examples/blog/schema.ts`) | `pgTable` equivalent                                   |
| `.env`            | `GLAZE_AUTH_SECRET`                               | `+ DATABASE_URL=<validated url>`                       |

Both configs carry the mandated comment: solo applies changes at boot; `'team'` exists and holds changes for
approval. Per CLAUDE.md §9 the comment states current behavior only — no migration narrative.

`.env` gets a real secret from `createAuthSecret()` (32 random bytes → 64 hex chars, well over
`MIN_AUTH_SECRET_LENGTH` = 32 in `packages/glaze-cms/lib/consts/defaults.ts`); `.env.example` gets a
placeholder. `.env` is gitignored by the emitted `.gitignore`, so the secret never leaves the machine.
`.env.example` omits `GLAZE_ADMIN_DEV_URL` — that's a monorepo-development flag, not an app flag.

---

## Post-scaffold

Order: **write files → `git init` → `bun install` → next steps.**

```ts
export async function installDependencies(directory: string): Promise<CommandResult>;
export async function initRepository(directory: string): Promise<CommandResult>;
```

- `node:child_process` spawn with `{ cwd: directory }` — see the portability rules above.
- **`bun install` under Bun, `npm install` under Node** (detected via `process.versions.bun`); never
  `bun add` — the manifest is already authored, so the install is deterministic.
- `git init` skipped when `--no-git`, when `git` is absent, or when the parent is already inside a work tree
  (don't nest a repo inside the monorepo during local testing). **No initial commit** — author identity may
  be unset, and committing is the user's call.
- **Both are non-fatal.** On failure: warn + print the exact manual command, still exit 0. The files are
  correct and valuable; failing the run over a network hiccup and leaving nothing is worse.
- **No `rm -rf` rollback.** The old CLI recursively deleted the target on any write error — a foot-gun the
  moment the target is `.` or pre-existing. Instead: refuse a non-empty directory up front (unless
  `--force`), and on a mid-write failure report what was written and stop. Only cleanup: remove the one
  directory we created this run, if it is still empty.

---

## Testing

This package **cannot import `#harness`** (intra-package to `glaze-cms`), so tests use `bun:test` directly.

**Root `test:node` stays as-is.** Its glob (`packages/glaze-cms/**/*.test.ts`) is correct — widening it would
require a cross-runtime test shim that can't be imported across packages. Root `bun test` picks the new tests
up automatically. The CLI's Node support is instead verified by **one explicit portability test** (below),
which is what actually matters: that the _bin_ runs under Node, not that the test files do.

1. **Unit** — `validation.test.ts` (including `my..app` must be _accepted_, `.` accepted, `\n` injection
   rejected), `naming.test.ts`, `secret.test.ts`, `parser.test.ts` (every flag, negations, unknown flag → error).
2. **`planner.test.ts` — the big one.** `planProjectFiles` is pure `(options, templates) => ProjectFile[]`, so
   a fake `TemplateSet` asserts the exact file list per dialect, that `package.json` parses with the right
   specifier for `--link` vs published, that `.env` carries the secret and `.env.example` does not, that
   postgres emits `DATABASE_URL` and sqlite doesn't, and that `_gitignore` lands as `.gitignore`.
3. **Integration** — `writer.test.ts` against `mkdtempSync(join(tmpdir(), 'glaze-create-'))`: on-disk file set,
   non-empty target refused without `--force`, permission error returns a typed failure rather than throwing.
4. **CLI end-to-end** — `cli.test.ts` spawns the real bin with `--yes --link … --no-install --no-git`; asserts
   exit code, next-steps output, files on disk, and the non-interactive failure paths.
5. **Portability** — the same scaffold run spawned as `node cli.ts …` and asserted to produce a byte-identical
   file set (modulo the generated secret). This is the single test that guards Node support; without it,
   portability silently rots.
6. **Drift guard** — assert the sqlite `schema.ts` / `server.ts` templates match `examples/blog/*`, so the two
   "what a Glaze app looks like" sources cannot silently diverge.

### The boot oracle — `boot.test.ts` (env-gated, the test that actually matters)

Scaffold sqlite into a temp dir with `--link <repo>/packages/glaze-cms --no-git` → install (the `link:`
symlink resolves glaze-cms's own deps from the monorepo `node_modules`) → spawn `bun server.ts` on a random
high port → poll `/_health` until 200 → **open `app.db` and assert `sqlite_master` contains `authors` and
`posts`** → `SIGTERM`, cleanup in `finally`.

Step 5 is the point: it proves **convergence ran against the scaffolded schema**, not merely that a process
started. Gated behind `GLAZE_E2E` / `CI` (needs network for `drizzle-orm`), 180 s timeout.

---

## Gate integration

- **typecheck** — package `typecheck` script; root `bun --filter '*' typecheck` picks it up, no root change.
- **lint** — root `oxlint --type-aware` covers it automatically. `no-console` is `warn` at root; handled by
  _not using console_: all output goes through `reporter.ts` / clack, and `--help`/`--version` use
  `process.stdout.write`. No config override. If a stray case appears, use a file-scoped
  `// oxlint-disable` (precedent: `packages/glaze-cms/harness/test-api.ts`).
- **`types: ["bun"]`** in the root tsconfig means Bun globals typecheck even in portable code. That is a
  convenience, not a licence — the portability rules above are the contract, and the Node spawn test is what
  enforces them.
- **format** — `oxfmt --check .` formats templates as ordinary source; no placeholders means no fight.
- **CI** — optionally add a `GLAZE_E2E=1` step to `gate-bun` in `.github/workflows/ci.yml`; leave `gate-node` alone.

---

## Verification

```bash
bun run typecheck && bun run lint && bun run format && bun test && bun run test:node
```

```bash
# end-to-end by hand, from the repo root
bun run packages/create-glaze-app/cli.ts /tmp/my-glaze-app --yes --dialect sqlite \
  --link "$PWD/packages/glaze-cms"
cd /tmp/my-glaze-app && bun dev     # → http://localhost:4000/_health, admin at /admin
```

```bash
# the same scaffold under Node, to prove portability
node packages/create-glaze-app/cli.ts /tmp/my-glaze-app-node --yes --dialect sqlite \
  --link "$PWD/packages/glaze-cms"
```

```bash
GLAZE_E2E=1 bun test packages/create-glaze-app
```

Done when reviewers find nothing **and** the gate is green (CLAUDE.md §6/§8). Per §8 this is
onboarding/scaffolding, not a data-safety path — one adversarial reviewer is proportionate, focused on the
directory-refusal / no-rollback logic and the `.env` secret handling.

---

## Risks, ranked

1. **Nothing installs without `--link` until `glaze-cms` is published.** Mitigated by `IS_PUBLISHED = false`
   - fail-fast with the exact command. Release = flip one const.
2. **`workspace:*` devDep on `glaze-cms`** (needed to typecheck templates) is publish-adjacent. It's a
   *dev*Dependency so consumers never install it; if it bites, `"exclude": ["templates"]` trades the
   typecheck away. Deferred.
3. **Template drift from `examples/blog`** — two sources of truth; mitigated by the drift test. Longer term,
   make `examples/blog` an actual scaffolder output.
4. **`link:` vs `file:`** — `link:` symlinks (deps resolve from the target, correct here); `file:` copies and
   would break glaze-cms's own resolution. Resolve `--link` to an absolute path before writing it.
5. **Boot-test flakiness** — random high port, generous timeout, env gate, hard cleanup in `finally`.
6. **Postgres path has no boot oracle locally** (no server). Typechecked + planner-tested only; a
   Testcontainers-backed postgres boot test is a later add.
7. **`.` as target** interacts with `--force` and the empty-dir cleanup — make sure `.` never triggers cleanup.
8. **Shebang behavior under `bun create` is the one unverified assumption.** `#!/usr/bin/env node` is chosen so
   `npm create` works, on the understanding that Bun executes bins with its own runtime. Verify first, before
   building on it; if Bun honors the shebang instead, the fallback is a tiny `.mjs` launcher that re-execs the
   `.ts` under the current runtime.
9. **Portability rot** — `types: ["bun"]` makes `Bun.*` typecheck fine, so a stray Bun API won't fail the gate.
   The Node spawn test is the only thing that catches it; do not let it be skipped.
