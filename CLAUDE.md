# CLAUDE.md

**[`AGENTS.md`](./AGENTS.md) is the source of truth for this repository** — what Glaze is, the
thesis, the architecture and its seams, the gate, testing, code style, build order. Read it first;
all of it applies. This file holds **only** what is specific to Claude Code, and deliberately does
not restate anything from `AGENTS.md` — two copies of the same rule drift.

## Adversarial review (`AGENTS.md` §8), concretely

§8 is **mandatory** for convergence and any data-safety path. In Claude Code that means:

- The **main thread implements and orchestrates**; reviewers are **fresh subagents**, so each gets
  its own context window and none of the implementer's bias.
- Run **2+ reviewers in parallel** — several Agent calls in one message — with the same brief:
  exhaustively enumerate reasons the change is buggy or does not work. Edge cases, wrong
  assumptions, data-loss paths, dialect divergence, partial-failure and rollback gaps.
- Strict roles: the implementer does not review, the reviewer does not implement.

## Tooling

- **`.mcp.json`** provides the `context7` MCP server. Drizzle (RC), Elysia 2 and Better Auth all
  move fast — look up current API shapes there rather than trusting recalled ones.
- **`.claude/settings.local.json`** is local and untracked. Project-wide rules do not go there;
  they go in `AGENTS.md`.
