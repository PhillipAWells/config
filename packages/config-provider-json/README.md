# @pawells/config-provider-json

[![CI](https://github.com/PhillipAWells/config/actions/workflows/ci.yml/badge.svg)](https://github.com/PhillipAWells/config/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@pawells/config-provider-json)](https://www.npmjs.com/package/@pawells/config-provider-json)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

## Description

`@pawells/config-provider-json` is an async configuration provider for `@pawells/config` that reads values from a JSON file and writes configuration snapshots or templates back to disk.

The file must contain a JSON object at the top level. Nested objects are flattened one level deep using `_` as the separator, so a key registered as `KEYCLOAK_HOST` is found at `{ "KEYCLOAK": { "HOST": "..." } }`. Top-level non-object values are kept at their own key unchanged. Native JSON types (numbers, booleans, arrays, `null`) are passed directly to Zod schema validation without string pre-processing.

The provider enforces a 10 MB file-size limit and rejects symlinks and path-traversal sequences (`..`) for security.

See the [workspace README](../../README.md) for an end-to-end quick start. See [CHANGELOG.md](../../CHANGELOG.md) for version history.

## Requirements

- Node.js `>=22.0.0`
- `@pawells/config` (peer dependency, installed as a direct dependency via `workspace:*` in the monorepo)

## Installation

```sh
yarn add @pawells/config-provider-json @pawells/config
```

All packages are ESM-only (`"type": "module"`).

## Quick Start

```typescript
import { ConfigManager, RegisterConfigSchema, Secret } from '@pawells/config';
import { ConfigJSONProvider } from '@pawells/config-provider-json';
import { z } from 'zod';

// Register providers BEFORE importing any schema modules.
const jsonProvider = await ConfigJSONProvider.Register({
    name: 'json',
    path: './config.json',
    required: false  // OK if the file does not exist yet
});

// config.json: { "APP": { "HOST": "localhost", "PORT": 3000 } }
// Flattens to: APP_HOST='localhost', APP_PORT=3000

const AppConfig = RegisterConfigSchema('App', z.object({
    HOST: z.string().min(1).default('localhost'),
    PORT: z.coerce.number().int().positive().default(3000),
    SECRET_KEY: Secret(z.string().min(32)).default(''),
}));

const host = AppConfig.Get('HOST'); // string
const port = AppConfig.Get('PORT'); // number

// Generate config.example.json — defaults; secrets written as null.
await ConfigManager.Save(jsonProvider, { path: './config.example.json' });

// Snapshot current runtime values.
await ConfigManager.Save(jsonProvider, {
    path: './config.snapshot.json',
    useCurrentValues: true
});
```

### JSON file format

Nested objects are flattened one level deep:

```json
{
    "APP": {
        "HOST": "localhost",
        "PORT": 3000,
        "DEBUG": false
    },
    "KEYCLOAK": {
        "HOST": "keycloak.example.com",
        "PORT": 8080
    }
}
```

Produces the configuration keys: `APP_HOST`, `APP_PORT`, `APP_DEBUG`, `KEYCLOAK_HOST`, `KEYCLOAK_PORT`.

Only one level of nesting is flattened. Deeper objects are skipped. Top-level non-object values (strings, numbers, booleans, arrays, `null`) are kept at their own key:

```json
{ "TOP_LEVEL_KEY": "value" }
```

Produces `TOP_LEVEL_KEY='value'`.

## API Reference

### `ConfigJSONProvider`

An async configuration provider that extends `ConfigProvider` from `@pawells/config`.

#### `static Register(options?)`

Convenience factory: creates a `ConfigJSONProvider` instance, registers it with `ConfigManager`, and returns it.

```typescript
static async Register(
    options?: Partial<TConfigJSONProviderOptions>
): Promise<ConfigJSONProvider>
```

Unspecified options use schema defaults (`path: <cwd>/config.json`, `required: false`). Note: `name` has no default and must be supplied.

```typescript
// Register with a specific path
const provider = await ConfigJSONProvider.Register({
    name: 'json',
    path: './config.json',
    required: false
});

// Register an optional local override file
const localProvider = await ConfigJSONProvider.Register({
    name: 'json-local',
    path: './config.local.json',
    required: false
});
```

#### Constructor

```typescript
new ConfigJSONProvider(options: TConfigJSONProviderOptions)
```

After constructing, pass the instance to `ConfigManager.RegisterProvider` manually if you need the instance before registration:

```typescript
import { ConfigManager } from '@pawells/config';
import { ConfigJSONProvider } from '@pawells/config-provider-json';

const provider = new ConfigJSONProvider({
    name: 'json',
    path: './config.json',
    required: true
});
await ConfigManager.RegisterProvider(provider);
```

**Throws** `ConfigError` if `options` fail schema validation (e.g. the path contains `..`).

#### `Load()`

```typescript
async Load(): Promise<Record<string, unknown>>
```

Reads and flattens the JSON configuration file:

1. The parent directory of `options.path` is canonicalized via `fs.realpath` to detect symlinked ancestor directories.
2. The file is opened with `O_NOFOLLOW` to atomically reject a symlinked final path component.
3. Content is read and the size is checked against the 10 MB limit.
4. The JSON is parsed; malformed JSON throws `ConfigError`.
5. Top-level properties are flattened one level deep (see format above).
6. Prototype-pollution keys (`__proto__`, `constructor`, `prototype`) are silently skipped.

If the file is absent (`ENOENT`) and `required` is `false`, returns `{}`. If `required` is `true`, throws `ConfigError`.

```typescript
// config.json: { "APP": { "HOST": "localhost", "PORT": 3000, "DEBUG": false } }
const values = await provider.Load();
// → { APP_HOST: 'localhost', APP_PORT: 3000, APP_DEBUG: false }
```

**Throws:**
- `ConfigError` — The file is a symlink (final component or parent directory).
- `ConfigError` — The file cannot be read and `required` is `true`.
- `ConfigError` — The file exceeds 10 MB.
- `ConfigError` — The file content is not valid JSON.

#### `Save(entries, options?)`

```typescript
async Save(
    entries: readonly ConfigSaveEntry[],
    options?: TConfigJSONProviderSaveOptions
): Promise<void>
```

Writes configuration entries to a nested JSON file. Call via `ConfigManager.Save` rather than directly.

**Template mode** (`useCurrentValues: false`, the default):
- Each entry is written using its registered default value.
- Entries where `entry.isSecret` is `true` are written as `null`, indicating that a value is required but intentionally absent.
- This is suitable for generating `config.example.json` files safe to commit.

**Current-values mode** (`useCurrentValues: true`):
- All entries including secrets are written with their live resolved values.

The output structure mirrors the input structure that `Load()` flattens: entries with a section (registered via a namespace) are nested under their section key. Entries without a section are written at the top level.

Output is pretty-printed with tab indentation.

**Options:**

| Field | Type | Default | Description |
|---|---|---|---|
| `path` | `string` (optional) | `this.options.path` | Output file path; overrides the constructor path if provided. `..` sequences are rejected. |
| `useCurrentValues` | `boolean` (optional) | `false` | `false` = registered defaults, secrets as `null`; `true` = live resolved values. |

---

### Options types

#### `TConfigJSONProviderOptions`

```typescript
type TConfigJSONProviderOptions = {
    name: string       // Required; unique identifier for diagnostics
    path: string       // Default: <cwd>/config.json; '..' sequences are rejected
    required: boolean  // Default: false; when true, missing file throws ConfigError
}
```

Validated by `CONFIG_JSON_PROVIDER_OPTIONS_SCHEMA`.

#### `TConfigJSONProviderSaveOptions`

```typescript
type TConfigJSONProviderSaveOptions = {
    path?: string             // Overrides constructor path if provided; '..' sequences are rejected
    useCurrentValues?: boolean  // Default: false
}
```

Validated by `CONFIG_JSON_PROVIDER_SAVE_OPTIONS_SCHEMA`.

---

### Assertion and validation utilities

| Export | Description |
|---|---|
| `CONFIG_JSON_PROVIDER_OPTIONS_SCHEMA` | Zod schema for `TConfigJSONProviderOptions` |
| `AssertConfigJSONProviderOptions(options)` | Asserts conformance; throws `ZodError` otherwise |
| `ValidateConfigJSONProviderOptions(options)` | Returns `true` if valid; `false` otherwise |
| `CONFIG_JSON_PROVIDER_SAVE_OPTIONS_SCHEMA` | Zod schema for `TConfigJSONProviderSaveOptions` |
| `AssertConfigJSONProviderSaveOptions(options)` | Asserts conformance; throws `ZodError` otherwise |
| `ValidateConfigJSONProviderSaveOptions(options)` | Returns `true` if valid; `false` otherwise |
| `CONFIG_JSON_PROVIDER_PATH_SCHEMA` | Zod schema for an individual path value |

---

### Error handling

```typescript
import { ConfigError } from '@pawells/config';
import { ConfigJSONProvider } from '@pawells/config-provider-json';

try {
    const provider = new ConfigJSONProvider({
        name: 'json',
        path: './config.json',
        required: true
    });
    await ConfigManager.RegisterProvider(provider);
} catch (error) {
    if (error instanceof ConfigError) {
        // Symlink detected, path traversal, JSON parse failure, file not found (required),
        // or size limit exceeded
        console.error('Configuration error:', error.message);
    } else {
        // File system permission error or other I/O error
        console.error('I/O error:', error);
    }
}
```

---

### Security

- **Symlink rejection** — The final path component is opened with `O_NOFOLLOW`. Parent directories are canonicalized via `fs.realpath`. Either form of symlink throws `ConfigError`.
- **Path-traversal protection** — Any path containing `..` is rejected by the options schema at construction time and at save time.
- **Prototype-pollution protection** — Keys `__proto__`, `constructor`, and `prototype` are silently skipped in both `Load()` and `Save()`.
- **Size limit** — Files larger than 10 MB (byte-accurate) throw `ConfigError` before parsing.
- **No string coercion** — Native JSON types are passed directly to Zod; no implicit string-to-number conversion occurs.

## License

MIT — See [LICENSE](../../LICENSE) for details.
