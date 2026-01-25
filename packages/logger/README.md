# @glaze/logger

A small wrapper around [Pino](https://github.com/pinojs/pino) that standardizes logging defaults for Glaze services.

## Installation

The package is published as part of the monorepo. Add it to a package's dependencies and install via the workspace toolchain.

```sh
bun install
```

## Usage

Create a logger tailored to the current environment. Production logs are JSON and include ISO timestamps; development logs are pretty-printed.

```ts
import { createLogger } from '@glaze/logger';

// Create a custom instance
const appLogger = createLogger({ name: 'api', level: 'debug' });
appLogger.info('Server started');

// Create another logger for a different module
const authLogger = createLogger({ name: 'auth' });
authLogger.warn('Rate limit nearing capacity');

// Add module-specific context using Pino's child logger
const dbLogger = appLogger.child({ module: 'database' });
dbLogger.error('Connection failed');
```

### Environment configuration

`createLogger` reads from `BUN_ENV` or `NODE_ENV` to determine whether to emit production or development formatting. Override the default log level with `LOG_LEVEL`.

| Variable               | Purpose                                       | Default       |
| ---------------------- | --------------------------------------------- | ------------- |
| `LOG_LEVEL`            | Sets the log verbosity (e.g. `debug`, `info`) | `info`        |
| `BUN_ENV` / `NODE_ENV` | Chooses production vs development formatting  | `development` |

Sensitive fields such as `password`, `token`, `apiKey`, `secret`, and `DATABASE_URL` are automatically redacted.

## Redaction

The logger redacts common secrets by default. For additional redaction paths, pass a custom array via the `redact` option in `createLogger`.

```ts
const secureLogger = createLogger({
	name: 'payments',
	level: 'info',
	redact: ['*.cardNumber', '*.cvv'], // Add custom fields to redact
});

secureLogger.info({ cardNumber: '4111-1111-1111-1111' }, 'Payment processed');
// Output: { cardNumber: '[REDACTED]', msg: 'Payment processed' }
```
