# AGENTS.md

Guidance for coding agents working in this repository. **This file is the source of truth.**
Tool-specific notes live alongside it (e.g. `CLAUDE.md` for Claude Code) and never restate what is
here. [`CONTEXT.md`](./CONTEXT.md) is the glossary — the word this project uses for each concept,
and the ones it has retired. Use its vocabulary in code, comments, docs and UI copy.

> **Status:** greenfield rewrite of Glaze CMS. The previous implementation lives at
> `../glaze-cms-old` (reference for _design intent only_ — do not copy its package/publishing
> setup or its drizzle-kit output-parsing). This document is the **source of truth for
> foundational decisions**; it is forward-looking until the scaffold lands, then becomes the
> standard "how to work here" guide.

---

## 1. What Glaze is — and the thesis

An open-source headless CMS built around **collaboration with guardrails**. Drizzle schemas are the
source of truth; CMS presentation metadata lives in an internal DB schema.

**The differentiator — read this first.** Several actors work on the same content and the same
structure at once. Glaze's job is to make that safe: any change that could destroy data or quietly
overwrite someone else's work becomes a **structured, reviewable decision** instead of something
that just applies. The guardrails _are_ the product, not a feature of it.

**The actors are people and agents, and the loop does not care which.** A non-technical editor, a
developer and an agent are three **origins** on one pipeline (§4), running the same loop: _propose →
structured review → approval → verified apply_. Convergence was designed so a non-technical person
could approve a schema change without touching migrations; an agent needs exactly the same machine.
Being actor-agnostic is what makes the thesis hold whether or not agent-driven editing becomes the
norm — agents are the newest origin, not the pitch.

**A consequence for the roadmap:** the quadrant `convergence.md` calls the hard nucleus (team +
audit — approver ≠ originator, approval asynchronous) is not an edge case under this thesis. It is
what collaboration _is_, so it moves from deferred to the main line.

**Convergence is the engine that makes this real — it is not a schema-sync utility, it is the
collaboration engine.** See §4.

**What the thesis commits us to:**

- **One principal model** — a person, an agent and a machine client sit on the same list and carry
  the same kind of permissions; there is no side door for API access. "What can this principal do"
  is a permissions question, so RBAC is designed in from the start, not retrofitted. Full policy
  model, minimal management UI; three built-in roles (`admin`, `editor`, and `user` as the floor
  every account starts on) so day one needs no config. An agent is not a principal of its own — it
  acts as the person who runs it, and what it does is recorded under that person's id.
- **`propose` and `approve` are first-class actions**, distinct from CRUD's `update`. A principal
  granted `propose` and never `approve` cannot write to production **by policy**, not by a rule
  buried in code. Approving a pending _structural_ change is a permission too.
- **Accept per suggestion, not per document.** Reviewing someone else's long set of edits is not an
  all-or-nothing decision; the right granularity is the change, not the entry.
- **Fail closed, everywhere.** What the data-loss oracle already does for structure is the rule for
  the whole system: when safety or exactness cannot be established, say so — never render, apply or
  approve something plausible-but-unverified.
- **Deliberately ceded:** large-team coordination — presence, live cursors, live co-editing, a
  Strapi-scale permissions UI, a Linear-class sync engine. That is a headcount game, and §2 says we
  cannot play it. Small teams (2–5) are the target; "review" already implies a second party.

## 2. Who it's built for (this drives every decision)

- **Solo maintainer who cannot babysit the project.**
- **AI-heavy development**: agents do most of the work and **must not be able to silently break
  things.** Guardrails — not vigilance — keep the project safe.
- Every architectural choice therefore optimizes for: (a) agents can't regress it (enforced by
  **types + tests + contained blast radius**), and (b) **low _ongoing_ maintenance.**

**Note the symmetry.** That is §1's thesis applied to this repository. The discipline needed to
build Glaze safely with agents is the discipline Glaze sells. A guardrail worth having here is
usually worth shipping.

## 3. Positioning — market the guardrail, not the runtime

"**Collaboration that cannot silently destroy anything**" is the wedge. "Runs everywhere", "great DX"
and "schemas in code" are what competitors (Payload/Directus/Strapi/Sanity) already say, and where
Glaze has no edge.

- **Marketing surface = the guarantee.** Lead with what _cannot silently happen_: no unreviewed
  structural change, no data lost without a decision, no agent writing straight to production.
  Prefer **enumerable** claims over adjectives — the five data-loss probes in `convergence/safety/`
  can be verified against the tests; "safe" can only be disputed.
- **Bun is a quiet capability, not the pitch.** Bun-native is real and stays in the code, but it is
  not why anyone picks a CMS, and Node 24 keeps narrowing the gap. Demoted from thesis to
  implementation detail — the status Node used to hold.
- **Retired rule:** "prefer Bun-native on anything users/community see." Choose the best tool per
  surface — Bun where it is genuinely better, portable where it is not. `bun create glaze` is no
  longer a priority for being a Bun touchpoint; it earns its place only as onboarding.
- **Technical substrate stays portable behind the seams (§5).** Unchanged.
- **Headless stays — with a declared contract.** LLMs made frontends cheap, therefore numerous and
  volatile, which _strengthens_ the case for keeping content out of them. The edge is that the
  frontend **declares what it consumes**, so Glaze can say "this change breaks the article page",
  and so entity→URL mapping and (later) visual editing come from the same declaration. Ship one
  template as the reference implementation of that contract — never a template gallery.

---

## 4. Convergence — the collaboration engine

Convergence keeps the DB schema in sync with code and Admin-UI changes across **kept-files ×
auto/audit** workflows. Its whole reason to exist is producing a **clean, structured,
translatable signal** about (a) _what a schema change will do_ and (b) _why something can't
proceed_ — so non-technical users can approve/resolve changes safely.

**Built on Drizzle-kit's programmatic SDK — NOT on shelling out and parsing text.** The old
implementation scraped drizzle-kit's human output (`lib/drizzle-kit/drizzle-output-parser.ts`),
which was fragile and is exactly why the collaboration UX felt infeasible. The rewrite uses:

- **`drizzle-kit/cli`** — typed `generate() / push() / pull() / up() / exportSql() / check()`.
- **`--output json`** — each command returns a typed envelope (`status / errors / payloads`).
- **Non-interactive auto-detection** — no TTY prompts; first-class programmatic/agentic use.
- (Available to the dev workflow: `drizzle-kit mcp`, `drizzle-kit skills`.)

Those envelopes ARE the collaboration data model:

| Drizzle envelope     | Powers                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `payloads`           | "here's what's about to change," rendered for a non-technical user to approve                             |
| typed `errors`       | mapped onto Glaze i18n `ErrorCode`s (e.g. `FIELD_NOT_NULL_NO_DEFAULT`); UI translates codes — no scraping |
| non-interactive flow | human-in-the-loop: surface decision → get resolution → continue                                           |
| structured `status`  | reliable team/audit pending-migration tracking                                                            |
| → WebSocket          | push envelopes to the Admin app; the payload is the UI's data model                                       |

Design intent (workflow matrix, granular ops, i18n codes, introspection→regenerate schema,
pending-migration hash sync) is in `../glaze-cms-old/docs/convergence-v2-summary.md` —
**re-architect around the SDK; do not port the parser.**

### Config — code-first, with a loadable `glaze.config.ts`

Config stays **code-first** (typed `.ts`, no JSON/YAML), but convergence's **out-of-process tooling**
(`bun glaze migrate`, `generate`, the drizzle-kit SDK) must resolve config **without booting the
server** — inline-only config passed to `glaze({…})` can't provide that (the CLI would have to execute
the server entry, with side effects). So the tooling substrate lives in a typed, side-effect-free
**`glaze.config.ts`** (`defineGlazeConfig({…})`, full types/JSDoc); the runtime `glaze()` **and** the
CLI import the **same** module — one source of truth. This also **removes** the old `drizzle.config.ts`
juggling (glaze-old merged it into a temp config at runtime): the user writes one file and Glaze
derives the drizzle config internally from it.

| `glaze.config.ts` (tooling-loadable, no side effects)                                                                | Code — `glaze({…})` (runtime behavior)                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dialect` · `connection`/DB creds (env ref) · `schema` path · `migrations` (`enabled`/`path`) · `workflow` (`audit`) | plugins · security (CORS/rate-limit) · admin/api prefixes · health · auth (Better Auth) · hooks · logger |

`connection` + `schema` are needed by tooling **and** runtime, so they live in the file as the single
source; the runtime reads them from there (no drift-prone second copy). `glaze()` auto-loads
`glaze.config.ts` when no inline config is passed; `bun create glaze` scaffolds it. **This reverses the
old "code-only, no config file" decision — do NOT collapse it back to inline-only; that breaks the CLI.**

---

## 5. Architecture: two seams, resolved once

Support a **matrix** — runtimes `{Bun, Node}` × dialects `{Postgres, SQLite}` — **without**
`if (isNode) / if (isSqlite)` in logic. Resolve the environment **once at the composition root**,
inject inward; logic is written against typed interfaces and is agnostic. Exactly two seams:

### Runtime seam (Bun vs Node) — also a _performance_ boundary

Writing everything with `node:fs` runs on Bun via the compat layer but is often **slower** than
native `Bun.file`/`Bun.write` — which would undercut the "Bun is fast" pitch. The adapter lets
each runtime use its **native-fast** primitive. **Elysia is the template** (Bun-associated, runs
on Node via an adapter — we mirror it). Narrow port surface (do **not** over-abstract):

- **File I/O** — `Bun.file`/`Bun.write` vs `node:fs`.
- **Process spawn** (drizzle-kit SDK invocation if out-of-process) — `Bun.spawn`/`Bun.$` vs `node:child_process`.
- **HTTP server** — Elysia's own adapter (`adapter: node()` vs default Bun; one line, we don't build it).
- **SQLite driver** — `bun:sqlite` (Bun) vs `better-sqlite3` (Node).

Standard cross-runtime APIs (`node:path`, most crypto, JSON) are used directly — no adapter.

### Dialect seam (Postgres vs SQLite) — kept THIN by delegating to drizzle-kit

**Delegate as much as possible to the drizzle-kit SDK.** It already generates dialect-correct DDL
for both dialects — including SQLite's limited-`ALTER` **table-rebuild dance** — so Glaze does **not**
hand-write DDL. This deletes the old per-dialect SQL layer and the scary rebuild logic outright; that
code lives in drizzle-kit, not here. The `Dialect` seam therefore covers only what the SDK doesn't:
**driver instantiation** (postgres.js / `bun:sqlite` / `better-sqlite3`) and small **type/metadata
mapping** (+ any introspection quirks). Convergence orchestrates SDK calls, reads the JSON envelopes,
and **never branches on dialect**. If some granular op isn't covered by the SDK, that single gap is the
only place a thin dialect implementation lives — and **types still guard it** (must be implemented for
every dialect or it won't compile).

### Settled technology choices

| Concern          | Choice                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP framework   | **Elysia 1.4.x now**; swap to **2.x behind the seam** when its ecosystem is ready (`@elysiajs/node`, cors, Better Auth). Elysia 2 is currently experimental (`exp.46`). |
| ORM / migrations | **Drizzle ORM + drizzle-kit programmatic SDK** (see §4)                                                                                                                 |
| Postgres driver  | **`postgres.js`** everywhere (app + convergence, both runtimes)                                                                                                         |
| Bun.SQL          | **Dropped** — convergence is gated by drizzle-kit; Bun.SQL buys nothing here                                                                                            |
| SQLite driver    | **`bun:sqlite`** (Bun) / **`better-sqlite3`** (Node); stock-SQLite DDL baseline. `node:sqlite` excluded (no drizzle-kit support).                                       |

The SQL driver is **not** where we fight for Bun-nativeness (Drizzle owns it). We fight for it
where we're not gated: file I/O, `bun:sqlite`, `Bun.serve`, tooling.

---

## 6. The gate — what makes the project agent-safe

Every change (yours or an agent's) is "done" only when the gate is green. All native-fast:

- **oxlint** (incl. type-aware via tsgolint) — replaces ESLint. The old "no deep imports" rule is
  obsolete (the `exports` manifest enforces the boundary). ESLint is a config-level fallback only.
- **oxfmt** (oxc's formatter) — replaces Prettier; formats **and** organizes imports (group-by-type:
  builtins → external → internal → relative → type-imports, blank lines between). Style: **tabs, single
  quotes, trailing-comma `all`**. oxfmt owns import order, so oxlint's `sort-imports` stays **off**.
  Prettier + `@ianvs/prettier-plugin-sort-imports` is the fallback only if oxfmt's grouping can't express a need.
- **TypeScript 7** (Go-native `tsc`, ~10× faster) — typecheck + editor. Runs every agent iteration.
- **Parameterized matrix test suite** — see §7.

## 7. Testing — the safety net, kept low-maintenance

Old pain was **maintenance** (over-mocking → drift; testing internals → brittle). Fixes double as
what makes matrix breadth cheap.

- **Three tiers:** unit (pure logic, co-located) · integration (real ephemeral DB, **no DB mocks**)
  · contract/HTTP (Elysia `app.handle(new Request())`, in-memory).
- **Parameterized matrix harness — BUILD IT FIRST.** One behavioral spec runs across the whole
  matrix. **Dialect** (PG/SQLite) is looped **in-process**; **runtime** (Bun/Node) is the **CI job
  matrix** (same specs under `bun test` and the Node runner). Breadth does **not** multiply test count.
- The harness provisions an isolated DB per test, builds a Glaze instance wired through both seams,
  expands one spec across targets, tears down. **It is the socket every feature plugs into.**
- **Test behavior/contracts, not internals.** **Minimal mocks.** Runner: **`bun test`**.
- Convergence's structured envelopes make solo/team + conflict flows **deterministically testable**
  (assert JSON, not parsed text).

---

## 8. Development workflow — adversarial write/review loops

The method Jared Sumner used to rewrite Bun in Rust (~50 dynamic agent workflows over 11 days:
https://bun.com/blog/bun-in-rust#loops-that-write-review-code). Work is loops —
`task → result (code) → review×N → apply(feedback)` — and confidence to merge large amounts of
LLM-authored code comes from three things, all adopted here. Glaze is a **backend framework** writing
**complex, correctness-critical logic** (convergence above all), so this is **mandatory for
convergence and any data-safety path**; lighter for low-stakes code (pure utils, admin cosmetics).

1. **Adversarial review in split context windows.** The agent that _wrote_ the code is biased to get
   it merged; a **separate reviewer in its own context window** is asked to **exhaustively enumerate
   reasons the change is buggy or does not work.** Strict role separation, per the post:
   **1 implementer : 2+ adversarial reviewers**, run in parallel — **the implementer does not review;
   the reviewer does not implement.** Reviewers hunt edge cases, wrong assumptions, data-loss paths,
   dialect divergence, partial-failure/rollback gaps. (Spawn reviewers as fresh subagents; the main
   thread implements/orchestrates.)
2. **A large behavioral oracle, not vibes.** Bun's confidence came from a language-independent test
   suite with ~a million assertions. Our analog is the **matrix-parameterized behavioral suite**
   (dialect/runtime-independent specs): convergence is verified **generate → apply → introspect the
   real DB → assert intent**, across the whole matrix. Compare observed outcomes; don't trust the
   diff. This is why the matrix harness is **built first** — it is the oracle the loop runs against.
3. **When something breaks, fix the process, not the output.** Don't hand-patch the bad code — fix the
   loop/prompt/spec that generated it, so the fix generalizes and the same class of bug stops
   recurring. This is what keeps the solo + AI-heavy model sustainable.

Loop: implement → parallel adversarial reviewers → apply feedback (or fix the generating process) →
re-review, until reviewers find nothing **and** the gate (§6) is green. Only then is it "done."

## 9. Code style & conventions

Complexity lives **deep in the tree; the top is a facade.** Entry points and exported functions read
like a table of contents — short, orchestration-only, delegating to small focused functions below;
the gnarly logic sits in leaf functions at the bottom. (glaze-old exemplars: `glaze()` in
`core/index.ts`, `runSoloWorkflow`, `resolveConfig` — each is a handful of named steps, with the
SQL-building / drift / validation detail down in `engine/*`, `sql/*`, `validators/*`.)

- **Facade / shallow top, deep complexity.** A reader should grasp _what_ a top-level function does
  from its body alone; _how_ is one level down. Keep functions flat with **guard clauses / early
  returns** — the happy path stays un-nested at the bottom.
- **Name every partial result.** Store intermediate work in **descriptive consts** that say what they
  hold (`const hasDestructive = …`, `const normalizedConfig = …`, `const statement = build…()`), not
  inline expressions. Destructure options at the top of the function.
- **File/module name = noun (the thing); function name = imperative verb (the action).** A file is
  named for what it _is_ (`resolver.ts`, `provisioner.ts`, `loader.ts`, `builder.ts`); the function it
  exports is named for what it _does_ (`resolveConfig()`, `provisionDatabase()`, `loadConfig()`,
  `buildX()`). Matches glaze-old (`detector.ts` → `detect*`, `executor.ts` → `execute*`). Barrels stay
  `index.ts`.
- **Function names = imperative verbs** (`create*`, `resolve*`, `build*`, `detect*`, `apply*`,
  `validate*`, `run*`).
- **Booleans / predicates = `is*` / `has*` / `should*`** (`isStrictValidation`, `hasDrift`); predicate
  helpers may read as `*Exists` / `*IsEmpty` (`tableExists`, `columnHasNulls`).
- **JSDoc on every function** — description + `@param` per parameter + `@returns` (+ `@throws` where it
  throws). Stricter than glaze-old (its deep operations often skipped it): the standard is now
  consistent JSDoc **everywhere**, non-negotiable on anything exported.
- **Consumer DX is a feature.** The public API must give great **autocomplete + docs on hover** — same
  goal as Types-as-documentation (§10): discriminated unions over loose types (e.g. `OperationResult`:
  `{ success: true … } | { success: false; code … }`), literal unions, and `@example` blocks.

### File & structure conventions (refined 2026-07-21)

- **`index.ts` is a barrel ONLY** — re-exports, never implementation. Code lives in a findable
  **noun-named file** (`composer.ts`, `resolver.ts`, `engine.ts`), not in `index.ts`. A tree of
  identical `index.ts` files is miserable to navigate in an IDE; named files are searchable.
- **Folder-per-concern + barrel, over long flat files.** Each concern is a folder with focused
  implementation file(s) + an `index.ts` barrel; split a file into more files under the same folder the
  moment it would grow long or hard to scan (the `convergence/*` and `server/*` pattern).
- **Absolute `#`-subpath imports for cross-concern deps** (`#config`, `#dialect`, `#consts`, `#utils`,
  `#types`, …); **relative `./` for same-folder siblings.** Defined in the package.json **`imports`
  map**. Do NOT use tsconfig `paths` / `@`-aliases — Glaze ships TS source run directly (no bundler), so
  `@/x` resolves in the editor but **fails at runtime and under `node --test`**. `#`-imports are the
  runtime-native standard (resolve under Bun / Node / tsc) and stay **intra-package**, preserving the
  atomic single-package publish (§10).
- **Verb functions in noun files — strictly.** Never ship a verb-named file (`create.ts`, `converge.ts`,
  `apply.ts`): use the agent-noun (`composer.ts`, `engine.ts`) or fold it into an existing noun file.
  Prefer clean short verbs (`start`/`stop`, not `runBoot`/`runShutdown`).
- **`lib/{consts,types,utils}` (package-level) for shared internals:** constant _values_ → `#consts`,
  global _types_ → `#types`, shared utility _functions_ → `#utils`. Don't inline shared consts / env
  helpers in feature files. (Replaces the old `shared/` folder.)
- **Shipped code comments must not reference the prior/old implementation** — that is migration context.
  Internal docs (the plan file, memory, `docs/`) may reference it; the codebase a consumer reads may not.

## 10. Package & distribution

One monorepo; **only one package is published.**

- **`glaze`** (published) — the framework. `config / convergence / dialect / runtime / server / logger /
lib` are **internal folders**, _not_ separately-published packages (internal imports use intra-package
  **`#`-subpath aliases** via the package.json `imports` map — no `workspace:*` version references, so
  publish is **atomic**; this eliminates the old out-of-sync multi-publish failure mode).
- **`admin`** (not published) — React/Vite app; builds into `glaze`'s bundled assets, **served by the
  Elysia/Bun server itself**. In **prod**: API + admin + collaboration WS run in **one process, one
  port, one artifact** (no sidecar/proxy). Same-origin ⇒ **no CORS for the admin** (CORS/security is
  only for external content-API consumers), Better Auth cookies just work, WS is same-origin. Asset
  serving uses the runtime seam (`Bun.file` on Bun / `node:fs` on Node). In **dev**: keep Vite's
  HMR — run the Vite dev server (own port) proxying `/api` to Bun (two processes in dev is correct).
  Static assets ⇒ not a lock-in (a CDN can still front them at scale); future flex: `bun build
--compile` → single self-contained binary.
- **`create-glaze-app`** (separate `bin`) — powers `bun create glaze` (onboarding = marketing).

**Distribution:** **git-install** now (`bun add github:...`); no self-hosted registry, no public
npm trail pre-v1. Rehearse publishing with `npm publish --dry-run` + `publint` +
`@arethetypeswrong/cli`. Public **npm at launch** (discoverability, Bun ecosystem lists).

### Types as documentation

Public types must read like docs in editor hover/autocomplete.

- Ship **Bun-native TS source** (`"default": "./index.ts"`) so types resolve from source and can't
  drift; emit `.d.ts` alongside for non-Bun editors. (This also de-risks TS 7's new declaration-emit
  pipeline — source is the primary type surface, `.d.ts` is secondary.)
- **TSDoc (+ `@example`) on every public export.** Literal/discriminated unions over primitives.
- **Explicit return annotations that cap inference at the boundary** — hovers stay clean; keep gnarly
  type machinery (DeepRequired, Strict, mergeSchema mapped types) **internal**.
- Public surface via curated `exports` subpaths (`glaze`, `glaze/types`, `glaze/schema`,
  `glaze/convergence`). Internal code stays out of `exports` — the manifest is the boundary.

---

## 11. Build order

**Done — the substrate:**

1. The two seams (§5) + the parameterized matrix test harness (§7).
2. **Postgres end-to-end:** server, auth, convergence, content CRUD.
3. **SQLite** behind the same seam + harness — both dialects, both runtimes.

**Next — the first vertical slice** (decided 2026-09-05). The substrate is built; what is not is the
surface where the thesis (§1) becomes visible. Convergence is real but invisible today: a developer
sees a boot log. It becomes the product only when a person is shown _"this change drops `subtitle`;
1,204 rows hold data"_ and can decide.

So: **pending approvals** (step 2 of `specs/design/convergence.md`'s build order) **plus the one
admin screen** that shows a pending change and lets a human approve or reject it — a vertical slice,
not another horizontal backend step. It also closes a live dead end: an audited change returns
`pending` but rolls the migration back, so an audited project detects changes, never applies them,
and offers no way to approve. Designed in full in `specs/design/pending-approvals.md` — spec'd
before any screen, so the UI does not shape the data model. A change is now held for what it does —
destructive holds, safe applies, impossible fails closed — and `audit` only decides whether the answer
comes from a terminal or a screen. What remains is the apply path and the screen.

**Constraint on everything after:** born type-checked for completeness and behavior-tested across
all targets (§7).

**Not on the critical path: real-time.** Under §1 it is _notification only_ — "this changed,
refresh" — with polling an acceptable fallback. The WebSocket used to sit inside this list as part
of "working CMS soonest"; it does not belong there, and `specs/design/convergence.md` already puts it
outside the convergence core.

## 12. Open / deferred

- **Admin-stack dependency survey** (Better Auth, React 19 / React Compiler, Base UI 1.0,
  TanStack Router/Start) — deferred until we build admin; doesn't touch seams/convergence/gate.
