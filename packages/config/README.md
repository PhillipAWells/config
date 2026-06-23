# Configuration Utility

[![CI](https://github.com/PhillipAWells/config/actions/workflows/ci.yml/badge.svg)](https://github.com/PhillipAWells/config/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@pawells/config.svg)](https://www.npmjs.com/package/@pawells/config)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Description

Runtime configuration manager with Zod schema validation and a pluggable provider system. Register named schemas with `RegisterConfigSchema` and supply one or more providers (async `IConfigProvider` implementations from `@pawells/config-provider-env`, `@pawells/config-provider-json`, or a custom provider) so that every key resolves through a layered precedence chain: defaults → providers → runtime overrides. Includes a `ConfigManager.Save` API for generating `.env` templates or snapshotting live values.

## Requirements

- **Node.js**: 22.0.0 or later
- **TypeScript**: 6.0.0 or later (if consuming from source)
- **zod**: ^4.4.3 (peer dependency, required at runtime for schema validation)

## Installation

Install from npm:

```bash
npm install @pawells/config
```

Or with yarn:

```bash
yarn add @pawells/config
```

## Quick Start

### Startup Order: Providers Before Schema Imports

Providers must be registered before any schema module is imported. Schema modules call `RegisterConfigSchema` at module evaluation time, so any provider registered after that point will not be visible to already-evaluated schemas.

```typescript
// main.ts — register providers FIRST, before any schema imports
import {
  ConfigManager,
} from '@pawells/config';
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';
import { ConfigJSONProvider } from '@pawells/config-provider-json';

// Providers are async; await their registration before importing schemas
await ConfigManager.RegisterProvider(new ConfigEnvironmentProvider({ name: 'env', path: '.env' }));
await ConfigManager.RegisterProvider(new ConfigJSONProvider({ name: 'json', path: './config.json' }));

// Now import schema modules — providers are already loaded
import { KeycloakConfig } from './config/keycloak.js';

const url = KeycloakConfig.Get('AUTH_SERVER_URL'); // resolved: env/JSON/defaults
```

### Defining a Schema Module

```typescript
// config/keycloak.ts
import { z } from 'zod/v4';
import { RegisterConfigSchema, Secret } from '@pawells/config';

const KEYCLOAK_SCHEMA = z.object({
  AUTH_SERVER_URL: z.string().url().default('http://localhost:8080/auth'),
  REALM: z.string().min(1).default('master'),
  CLIENT_ID: z.string().min(1).default('nestjs-example-service'),
  CLIENT_SECRET: Secret(z.string().default('')),
});

// Registered immediately — prefix is derived as 'KEYCLOAK_'
export const KeycloakConfig = RegisterConfigSchema('Keycloak', KEYCLOAK_SCHEMA);
```

### Reading Values, Overriding, and Saving

```typescript
// Reading values
const url = KeycloakConfig.Get('AUTH_SERVER_URL'); // string
const realm = KeycloakConfig.Get('REALM'); // string

// Validate without setting
KeycloakConfig.Validate('REALM', 'my-realm'); // true/false

// Runtime override
KeycloakConfig.Set('REALM', 'my-realm', 'OVERRIDE');

// Save .env.example — registered defaults; secret fields written as blank
const envProvider = new ConfigEnvironmentProvider();
ConfigManager.Save(envProvider, { path: '.env.example' });

// Snapshot current resolved values
ConfigManager.Save(envProvider, { path: '.env', useCurrentValues: true });
```

### Error Handling

```typescript
import {
  ConfigNotRegisteredError,
  ConfigNotSetError,
  ConfigError,
} from '@pawells/config';

try {
  const value = KeycloakConfig.Get('AUTH_SERVER_URL');
} catch (error) {
  if (error instanceof ConfigNotRegisteredError) {
    /* key not registered */
  }
  if (error instanceof ConfigNotSetError) {
    /* value was never set */
  }
  if (error instanceof ConfigError) {
    /* validation failure; check error.cause */
  }
}
```

## API Reference

### RegisterConfigSchema

```typescript
RegisterConfigSchema<TSchema>(name: string, schema: z.ZodObject<TSchema>): IConfigSchemaObject<...>
```

- `name` — Namespace name. The environment variable prefix is derived as `name.toUpperCase() + '_'` (e.g. `'Keycloak'` → `KEYCLOAK_`).
- `schema` — Zod object schema. All fields should declare defaults.
- Registers all fields with `ConfigManager` immediately at call time.
- **Important:** Providers must be registered before this module is imported.

### IConfigSchemaObject Methods

| Method                        | Description                                                             |
| ----------------------------- | ----------------------------------------------------------------------- |
| `name`                        | The namespace name passed to `RegisterConfigSchema`.                    |
| `Get<K>(key)`                 | Retrieve a typed value. Resolves DEFAULT → providers → OVERRIDE.        |
| `Set<K>(key, value, source?)` | Set a value (`'OVERRIDE'` by default); validates against the schema.    |
| `Validate<K>(key, value)`     | Validate a value without setting it; returns boolean.                   |
| `ParseENV(throwOnError?)`     | Read `process.env` entries for this namespace and set them as OVERRIDE. |
| `IsSecret(key)`               | Returns `true` if the field was marked with `Secret()`.                 |
| `GetSecretKeys()`             | Returns all secret field names in schema order.                         |
| `Redact()`                    | Returns a snapshot with secret values replaced by `'***'`.              |

### ConfigManager

| Method                            | Description                                                                 |
| --------------------------------- | --------------------------------------------------------------------------- |
| `RegisterProvider(provider)`      | Register an async config provider. Returns `Promise<void>`. Must be awaited before importing schema modules. |
| `RegisterSyncProvider(provider)`  | Register a sync config provider (escape hatch). Use only in non-async contexts. |
| `RegisterNamespace(name, prefix)` | Called automatically by `RegisterConfigSchema`; rarely needed directly.     |
| `Save(provider, options)`         | Build entries for all registered keys and delegate to `provider.save()`.    |
| `Register(key, schema, default)`  | Register an individual fully-qualified key directly (advanced).             |
| `Set(key, value, target?)`        | Set a value for a fully-qualified key.                                      |
| `Get(key, source?)`               | Get a value for a fully-qualified key.                                      |
| `GetSchema(key)`                  | Retrieve the Zod schema for a fully-qualified key.                          |
| `Reset()`                         | Clear all state. For testing only.                                          |

### Providers

Provider implementations are located in separate packages:

#### @pawells/config-provider-env

Async environment variable + dotenv provider.

```typescript
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';
const provider = new ConfigEnvironmentProvider({ name: 'env', path: '.env', required: true });
await ConfigManager.RegisterProvider(provider);
```

Reads all `process.env` entries at provider load time. If `path` is given it overlays a dotenv file on top (dotenv values win over `process.env`). When `required = true` the provider throws if the file is missing; `false` silently skips it.

Implements `ISaveableConfigProvider`: async `Save()` writes `.env` format. In template mode (default), secret fields are written as empty values.

#### @pawells/config-provider-json

Async JSON file provider.

```typescript
import { ConfigJSONProvider } from '@pawells/config-provider-json';
const provider = new ConfigJSONProvider({ name: 'json', path: './config.json', required: true });
await ConfigManager.RegisterProvider(provider);
```

Reads a JSON file and flattens nested keys into fully-qualified names (e.g. `{ "KEYCLOAK": { "HOST": "x" } }` → `KEYCLOAK_HOST`). When `required = true` the provider throws if the file is missing.

Implements `ISaveableConfigProvider`: async `Save()` writes nested JSON. In template mode, secret fields are written as `null`.

#### ConfigManager.Save Options

```typescript
ConfigManager.Save(provider, { path: '.env.example' }); // template mode
ConfigManager.Save(provider, { path: '.env', useCurrentValues: true }); // current values
```

| Option             | Default  | Description                                                                  |
| ------------------ | -------- | ---------------------------------------------------------------------------- |
| `path`             | required | Output file path.                                                            |
| `useCurrentValues` | `false`  | `false` = registered defaults, secrets blank. `true` = live resolved values. |

#### Custom Providers

Implement `IConfigProvider` for async read-only sources, `ISaveableConfigProvider` for async writable ones, or `ISyncConfigProvider` for sync-only escape hatches:

```typescript
// Async provider (recommended)
class MyAsyncProvider implements IConfigProvider {
  readonly name = 'my-async';
  async Load(): Promise<Record<string, unknown>> {
    return { MY_APP_HOST: 'localhost' }; // use fully-qualified key names
  }
  async Save(): Promise<void> {
    // optional: implement to make it ISaveableConfigProvider
  }
}
await ConfigManager.RegisterProvider(new MyAsyncProvider());

// Sync provider (escape hatch for non-async contexts)
class MySyncProvider implements ISyncConfigProvider {
  readonly name = 'my-sync';
  LoadSync(): Record<string, unknown> {
    return { MY_APP_HOST: 'localhost' };
  }
}
ConfigManager.RegisterSyncProvider(new MySyncProvider());
```

### Precedence

```
DEFAULT  →  providers (registration order)  →  OVERRIDE
              ↑ ConfigEnvironmentProvider
              ↑ ConfigJSONProvider
```

Later-registered providers win over earlier ones for the same key.

### Error Types

| Error                          | When thrown                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `ConfigRegistrationError`      | Registering a key that already exists with a different schema. |
| `ConfigNotRegisteredError`     | Accessing a key with no registered schema.                     |
| `ConfigNotSetError`            | Getting a value that was never set.                            |
| `ConfigValidationError`        | Validation failure; wraps the Zod error as `cause`.            |
| `ConfigError`                  | Base error class for all config errors.                         |

### Type Exports

| Type                      | Description                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `TConfigValueTypes`       | `string \| number \| boolean \| Date \| string[] \| number[] \| boolean[] \| undefined \| null` |
| `TConfig`                 | `Map<string, TConfigValueTypes>`                                                                |
| `TConfigSource`           | `'DEFAULT' \| 'OVERRIDE'`                                                                       |
| `IConfigProvider`         | Async contract for config source providers (`Load()` and `Save()` both return `Promise`).       |
| `ISaveableConfigProvider` | Extends `IConfigProvider` with async `Save()` method.                                           |
| `ISyncConfigProvider`     | Sync escape hatch: `LoadSync()` returns `Record<string, unknown>` (no Save).                    |
| `ConfigSaveEntry`         | Per-key data object passed to `provider.Save()`.                                                |
| `SaveOptions`             | `{ path: string; useCurrentValues?: boolean }`                                                  |
| `Secret<T>(schema)`       | Mark a Zod field as sensitive; affects `Redact()` and template-mode saves.                      |

> **⚠️ Security Warning**
>
> Do not store sensitive values (API keys, database passwords, tokens, PII) directly as string literals in your code. Always load sensitive configuration from environment variables or secure vaults at startup.
>
> When storing environment variable overrides, ensure the process environment itself is protected from inspection (e.g., via debugger or memory dumps).
>
> Example:
>
> ```typescript
> // ✓ Good: Load from environment at startup
> const db = RegisterConfigSchema(
>   'DB',
>   z.object({
>     PASSWORD: Secret(z.string().default('')),
>   }),
> );
>
> // ✗ Bad: Hardcoded secrets
> ConfigManager.Register('DB_PASSWORD', z.string(), 'hardcoded-password');
> ```

## License

MIT — See [LICENSE](../../LICENSE) for details.
