# Glaze CMS

Open source, Bun-native headless CMS framework for modern web applications.

> **Note:** Glaze is in early active development (pre-v1). APIs and schemas may change.

## Features

- Built on [Bun](https://bun.sh) and [Elysia](https://elysiajs.com)
- Plugin architecture with built-in auth, admin dashboard, and security
- [Drizzle ORM](https://orm.drizzle.team) with Postgres
- [Better Auth](https://www.better-auth.com) integration
- React 19 admin dashboard
- Structured logging with automatic redaction of sensitive fields

## Packages

| Package | Description |
| --- | --- |
| `@glaze/cms` | Public API — what users import |
| `@glaze/core` | CMS server with Elysia plugin architecture |
| `@glaze/admin` | React 19 admin dashboard |
| `@glaze/shared` | Shared utilities and types |
| `@glaze/logger` | Pino-based structured logging |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1+
- PostgreSQL (or use the included Docker setup)

### Local Development

```bash
# Install dependencies
bun install

# Start all packages with hot reloading
bun dev

# Or use Docker (starts server + Postgres)
docker compose -f packages/development/docker-compose.yml up
```

The server starts on port **4000** by default.

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` / `GLAZE_PORT` | Server port | `4000` |
| `DATABASE_URL` / `GLAZE_DATABASE_URL` | Postgres connection string | — |

## Commands

```bash
bun dev            # Start dev server with hot reload
bun test           # Run all tests
bun lint           # Lint all packages
bun format         # Check formatting
bun typecheck      # Type check all packages
```

## License

MIT
