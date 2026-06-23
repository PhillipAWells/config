# @pawells/config-provider-env

[![CI](https://github.com/PhillipAWells/config/actions/workflows/ci.yml/badge.svg)](https://github.com/PhillipAWells/config/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@pawells/config-provider-env)](https://www.npmjs.com/package/@pawells/config-provider-env)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

## Description

`@pawells/config-provider-env` is a configuration provider for `@pawells/config` that loads settings from `process.env` and an optional `.env` file. Values in the dotenv file overwrite `process.env` for the same key. Environment variable strings are parsed to their native JavaScript types (numbers, booleans, arrays, `null`) before being handed to `ConfigManager` for schema validation.

The provider also supports writing configuration back to disk (`Save`), making it suitable for generating `.env.example` templates and snapshotting live values.

See the [workspace README](../../README.md) for an end-to-end quick start. See [CHANGELOG.md](../../CHANGELOG.md) for version history.

## Requirements

- Node.js `>=22.0.0`
- `@pawells/config` (peer dependency, installed as a direct dependency via `workspace:*` in the monorepo)

## Installation

```sh
yarn add @pawells/config-provider-env @pawells/config
```

All packages are ESM-only (`"type": "module"`).

## Quick Start

```typescript
import { ConfigManager, RegisterConfigSchema, Secret } from '@pawells/config';
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';
import { z } from 'zod';

// Register the provider BEFORE importing any schema modules.
// The factory method creates, registers, and returns the provider instance.
const envProvider = await ConfigEnvironmentProvider.Register({ path: '.env' });

// Define a schema — provider values are already available.
const AppConfig = RegisterConfigSchema('App', z.object({
    HOST: z.string().min(1).default('localhost'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_KEY: Secret(z.string().min(1)).default(''),
}));

// Read typed values.
const host = AppConfig.Get('HOST'); // string
const port = AppConfig.Get('PORT'); // number

// Generate .env.example — defaults written; secrets blank.
await ConfigManager.Save(envProvider, { path: '.env.example' });

// Snapshot current runtime values — secrets included.
await ConfigManager.Save(envProvider, { path: '.env.snapshot', useCurrentValues: true });
```

## API Reference

### `ConfigEnvironmentProvider`

An async configuration provider that extends `ConfigProvider` from `@pawells/config`.

#### `static Register(options?)`

Convenience factory: creates a `ConfigEnvironmentProvider` instance, registers it with `ConfigManager`, and returns it.

```typescript
static async Register(
    options?: Partial<TConfigENVProviderOptions>
): Promise<ConfigEnvironmentProvider>
```

Unspecified options use schema defaults (`name: 'environment'`, `path: <cwd>/.env`).

```typescript
// Register with all defaults
const provider = await ConfigEnvironmentProvider.Register();

// Register with a custom path
const provider = await ConfigEnvironmentProvider.Register({
    path: '.env.production'
});
```

#### Constructor

```typescript
new ConfigEnvironmentProvider(options: TConfigENVProviderOptions)
```

After constructing, pass the instance to `ConfigManager.RegisterProvider` manually if you need the instance before registration:

```typescript
import { ConfigManager } from '@pawells/config';
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';

const provider = new ConfigEnvironmentProvider({ name: 'env', path: '.env' });
await ConfigManager.RegisterProvider(provider);
```

#### `Load()`

```typescript
async Load(): Promise<Record<string, unknown>>
```

Loads configuration from `process.env` and optionally the `.env` file at `options.path`:

1. All entries in `process.env` are read first.
2. If `options.path` is set, the dotenv file is parsed and its entries overwrite `process.env` values for the same key.
3. All string values are passed through an internal parser that converts JSON-encoded booleans, numbers, arrays, and `null` to their native JavaScript types. Plain strings are returned unchanged.
4. If the dotenv file is absent (`ENOENT`), it is silently skipped — only `process.env` is returned.
5. Security exceptions (symlink path, path-traversal sequence) are propagated as errors.

```typescript
// .env: APP_PORT=8080
// process.env: APP_HOST=prod.example.com
const values = await provider.Load();
// → { APP_HOST: 'prod.example.com', APP_PORT: 8080 }
```

**Throws** `ConfigError` when the dotenv path is a symlink or contains a `..` traversal sequence.

#### `Save(entries, options?)`

```typescript
async Save(
    entries: readonly ConfigSaveEntry[],
    options?: TConfigENVProviderSaveOptions
): Promise<void>
```

Writes configuration entries to a `.env`-format file. Call via `ConfigManager.Save` rather than directly.

**Template mode** (`useCurrentValues: false`, the default):
- Each entry is written as `KEY=<default value>`.
- Entries where `entry.isSecret` is `true` are written as `KEY=` (blank value), regardless of their default.
- This is suitable for generating `.env.example` files safe to commit.

**Current-values mode** (`useCurrentValues: true`):
- All entries including secrets are written with their live resolved values.
- Use for runtime snapshots or debugging.

If a Zod `.describe()` annotation is present on the field, it is emitted as a `# comment` line immediately before the key.

```typescript
// Template output in .env.example:
// # Server port
// APP_PORT=3000
// # API key
// APP_API_KEY=
```

**Options:**

| Field | Type | Default | Description |
|---|---|---|---|
| `path` | `string` (optional) | `this.options.path` | Output file path; overrides the constructor path if provided. |
| `useCurrentValues` | `boolean` (optional) | `false` | `false` = registered defaults, secrets blank; `true` = live resolved values. |

---

### Options types

#### `TConfigENVProviderOptions`

```typescript
type TConfigENVProviderOptions = {
    name: string  // Default: 'environment'
    path: string  // Default: <cwd>/.env; '..' sequences are rejected
}
```

Validated by `CONFIG_ENV_PROVIDER_OPTIONS_SCHEMA`.

#### `TConfigENVProviderSaveOptions`

```typescript
type TConfigENVProviderSaveOptions = {
    path?: string            // Overrides constructor path if provided; '..' sequences are rejected
    useCurrentValues?: boolean  // Default: false
}
```

Validated by `CONFIG_ENV_PROVIDER_SAVE_OPTIONS_SCHEMA`.

---

### Assertion and validation utilities

| Export | Description |
|---|---|
| `CONFIG_ENV_PROVIDER_OPTIONS_SCHEMA` | Zod schema for `TConfigENVProviderOptions` |
| `AssertConfigENVProviderOptions(options)` | Asserts conformance; throws `ZodError` otherwise |
| `ValidateConfigENVProviderOptions(options)` | Returns `true` if valid; `false` otherwise |
| `CONFIG_ENV_PROVIDER_SAVE_OPTIONS_SCHEMA` | Zod schema for `TConfigENVProviderSaveOptions` |
| `AssertConfigENVProviderSaveOptions(options)` | Asserts conformance; throws `ZodError` otherwise |
| `ValidateConfigENVProviderSaveOptions(options)` | Returns `true` if valid; `false` otherwise |

---

### Security

- **Symlink rejection** — The dotenv path is checked; if it resolves to a symlink, `Load()` throws a `ConfigError`.
- **Path-traversal protection** — Any path containing `..` is rejected by the options schema at construction time and at save time.

## License

MIT — See [LICENSE](../../LICENSE) for details.
