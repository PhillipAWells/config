# @pawells/config

[![CI](https://github.com/PhillipAWells/config/actions/workflows/ci.yml/badge.svg)](https://github.com/PhillipAWells/config/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@pawells/config)](https://www.npmjs.com/package/@pawells/config)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

## Description

`@pawells/config` is the core package of the `@pawells/config-workspace` suite. It provides:

- A **global singleton** (`ConfigManager`) and an **instance-based** (`ScopedConfigManager`) configuration manager, both backed by [Zod](https://zod.dev) schema validation.
- A **schema factory** (`RegisterConfigSchema`) that derives typed, namespaced accessor objects from a Zod object schema, eliminating the need to call `ConfigManager.Register` for every key individually.
- A **`Secret()` wrapper** that marks Zod field schemas as sensitive — secret values are automatically redacted in templates and error messages.
- An **abstract base class** (`ConfigProvider`) and two interfaces (`IConfigProvider`, `ISyncConfigProvider`) for building custom providers.
- A structured **error hierarchy** rooted at `ConfigError`.

Values are resolved through a three-tier precedence model:

```
Registered defaults  <  Provider values  <  Runtime overrides (Set)
```

See the [workspace README](../../README.md) for an end-to-end quick start. See [CHANGELOG.md](../../CHANGELOG.md) for version history.

## Requirements

- Node.js `>=22.0.0`
- `zod` `^4.4.3` (peer dependency, installed automatically)

## Installation

```sh
yarn add @pawells/config
```

## Quick Start

```typescript
import { z } from 'zod';
import { ConfigManager, RegisterConfigSchema, Secret } from '@pawells/config';
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';

// 1. Register providers BEFORE importing schema modules.
//    Provider values are merged into schemas at registration time.
await ConfigEnvironmentProvider.Register({ path: '.env' });

// 2. Define and register a schema.
//    The prefix 'DATABASE_' is derived from the name 'Database'.
const DatabaseConfig = RegisterConfigSchema('Database', z.object({
    HOST: z.string().min(1).default('localhost'),
    PORT: z.coerce.number().int().positive().default(5432),
    PASSWORD: Secret(z.string().min(1)).default(''),
}));

// 3. Retrieve validated, typed values.
const host = DatabaseConfig.Get('HOST');  // string
const port = DatabaseConfig.Get('PORT');  // number

// 4. Redact secrets for safe logging.
console.log(DatabaseConfig.Redact());
// → { HOST: 'localhost', PORT: 5432, PASSWORD: '***' }
```

## API Reference

### `RegisterConfigSchema(name, schema)`

Registers all fields of a Zod object schema with `ConfigManager` and returns a typed accessor object.

```typescript
function RegisterConfigSchema<TSchema extends z.ZodRawShape>(
    name: string,
    schema: z.ZodObject<TSchema>
): IConfigSchemaObject<z.infer<typeof schema>>
```

- `name` — Human-readable namespace. The env-var prefix is derived as `name.toUpperCase() + '_'` (e.g. `'Database'` → `DATABASE_`).
- `schema` — A `z.object(...)` schema. Every field should declare a `.default(...)` value.

**Returns** an `IConfigSchemaObject` with the following members:

| Member | Signature | Description |
|---|---|---|
| `name` | `string` | The namespace name passed to `RegisterConfigSchema`. |
| `Get` | `Get<K>(key: K): TConfig[K]` | Retrieve the typed, validated value for `key`. Resolves DEFAULT → providers → OVERRIDE. |
| `Set` | `Set<K>(key: K, value: TConfig[K], source?: TConfigSource): void` | Set a value. Target is `'OVERRIDE'` by default. |
| `Validate` | `Validate<K>(key: K, value: unknown): boolean` | Check whether a value satisfies the field schema without setting it. |
| `IsSecret` | `IsSecret(key: TKeys): boolean` | Returns `true` if the field was wrapped with `Secret()`. |
| `GetSecretKeys` | `GetSecretKeys(): Array<TKeys>` | Returns all keys marked with `Secret()` in schema insertion order. |
| `Redact` | `Redact(): Record<string, unknown>` | Returns all resolved values; secret fields are replaced with `'***'`. Unset/unregistered keys are omitted. |

**Important:** Call `ConfigManager.RegisterProvider` for all providers before any module that calls `RegisterConfigSchema` is imported. Provider values are captured when schemas are registered.

---

### `Secret(schema)`

Marks a Zod field schema as secret using Zod v4's `globalRegistry` metadata. The TypeScript inferred type of the schema is unchanged.

```typescript
function Secret<T extends z.ZodTypeAny>(schema: T): T
```

```typescript
import { Secret } from '@pawells/config';
import { z } from 'zod';

// In a schema definition:
const schema = z.object({
    API_KEY: Secret(z.string().min(32)).default(''),
});
```

Secret fields are:
- Blanked (empty value) in `.env` template output (`ConfigEnvironmentProvider.Save` in template mode).
- Written as `null` in JSON template output (`ConfigJSONProvider.Save` in template mode).
- Replaced with `'***'` by `IConfigSchemaObject.Redact()`.
- Sanitized from `ConfigValidationError` messages and causes on validation failure.

---

### `ConfigManager`

A static singleton configuration manager. All state is shared across the process for the lifetime of the module.

```typescript
class ConfigManager {
    static Register(key: string, schema: z.ZodTypeAny, defaultValue: unknown): void
    static Get(key: string, source?: TConfigSource): TConfigValueTypes
    static Set<T extends TConfigValueTypes>(key: string, value: T, target?: TConfigSource): void
    static GetSchema(key: string): z.ZodTypeAny
    static async RegisterProvider(provider: IConfigProvider): Promise<void>
    static RegisterSyncProvider(provider: ISyncConfigProvider): void
    static async Save(provider: IConfigProvider, options: SaveOptions): Promise<void>
    static RegisterNamespace(name: string, prefix: string): void
    static SetValidationWarningHandler(handler: ((key: string, providerName: string) => void) | undefined): void
    static Reset(): void
}
```

| Method | Description |
|---|---|
| `Register(key, schema, defaultValue)` | Register a key with its Zod schema and initial default. Throws `ConfigRegistrationError` if re-registered with a different schema. Throws `ConfigValidationError` if `defaultValue` fails. |
| `Get(key, source?)` | Retrieve the resolved value for `key`. Pass `'DEFAULT'` or `'OVERRIDE'` to read a specific tier only. Throws `ConfigNotRegisteredError` or `ConfigNotSetError` if unavailable. |
| `Set(key, value, target?)` | Set a value on the `'OVERRIDE'` tier (default) or `'DEFAULT'` tier. Throws `ConfigNotRegisteredError` or `ConfigValidationError`. |
| `GetSchema(key)` | Return the registered Zod schema for `key`. Throws `ConfigNotRegisteredError`. |
| `RegisterProvider(provider)` | Async. Register an `IConfigProvider`; calls `provider.Load()` immediately. Provider values are the middle tier. Last-registered wins for duplicate keys. |
| `RegisterSyncProvider(provider)` | Register an `ISyncConfigProvider`; calls `provider.LoadSync()` immediately. Use only when `await` is not available. |
| `Save(provider, options)` | Async. Build a `ConfigSaveEntry[]` for every registered key and delegate to `provider.Save()`. |
| `RegisterNamespace(name, prefix)` | Record a `prefix → sectionName` mapping used by `Save()` to split keys into section/field components. Called automatically by `RegisterConfigSchema`. |
| `SetValidationWarningHandler(handler)` | Set a callback invoked when a provider value fails schema validation. Silent by default. Pass `undefined` to clear. |
| `Reset()` | Clear all state. Intended for test isolation only. |

**`TConfigSource`** — `'DEFAULT' | 'OVERRIDE'`

**`TConfigValueTypes`** — the full union accepted by all schemas:
`string | number | boolean | Date | string[] | number[] | boolean[] | undefined | null`

**`TConfig`** — `Map<string, TConfigValueTypes>`

---

### `ScopedConfigManager`

An instance-based configuration manager. Each instance maintains fully independent state, making it suitable for test isolation and multi-tenant scenarios. The public API mirrors `ConfigManager` exactly as instance methods.

```typescript
const config = new ScopedConfigManager();
config.Register('PORT', z.coerce.number(), 3000);
await config.RegisterProvider(myProvider);
const port = config.Get('PORT'); // 3000
```

`ScopedConfigManager` exposes: `Register`, `Get`, `Set`, `GetSchema`, `RegisterProvider`, `RegisterSyncProvider`, `Save`, `RegisterNamespace`, `SetValidationWarningHandler`, `Reset`.

---

### `ConfigProvider` (abstract base class)

Extend this class to build a custom provider. Both `Load` and `Save` are abstract and must be implemented.

```typescript
abstract class ConfigProvider<
    TOptions extends TConfigProviderOptions = TConfigProviderOptions,
    TLoadOptions = unknown,
    TSaveOptions extends TConfigProviderSaveOptions = TConfigProviderSaveOptions
> {
    readonly Name: string
    abstract Load(options?: TLoadOptions): Promise<Record<string, unknown>>
    abstract Save(entries: readonly ConfigSaveEntry[], options?: TSaveOptions): Promise<void>
}
```

```typescript
import { ConfigProvider, type TConfigProviderOptions, type ConfigSaveEntry } from '@pawells/config';

class RedisProvider extends ConfigProvider {
    async Load(): Promise<Record<string, unknown>> {
        // Return a flat key-value record; keys must be fully qualified.
        return { APP_HOST: 'redis-host' };
    }

    async Save(_entries: readonly ConfigSaveEntry[]): Promise<void> {
        // Implement if this provider supports writes.
    }
}
```

---

### Provider interfaces

**`IConfigProvider`** — async providers (preferred):

```typescript
interface IConfigProvider {
    readonly Name: string
    Load(): Promise<Record<string, unknown>>
    Save(entries: readonly ConfigSaveEntry[], options?: SaveOptions): Promise<void>
}
```

**`ISyncConfigProvider`** — synchronous read-only providers (escape hatch):

```typescript
interface ISyncConfigProvider {
    readonly Name: string
    LoadSync(): Record<string, unknown>
}
```

---

### `SaveOptions`

Passed to `ConfigManager.Save` and `IConfigProvider.Save`:

```typescript
interface SaveOptions {
    path: string              // Destination file path
    useCurrentValues?: boolean // false (default) = registered defaults; true = live resolved values
}
```

---

### `ConfigSaveEntry` / `IConfigSaveEntry`

One entry per registered key, built by `ConfigManager.Save` and passed to `provider.Save`:

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Fully-qualified key (e.g. `DATABASE_HOST`) |
| `section` | `string` | Namespace section (e.g. `DATABASE`); empty string if no namespace |
| `field` | `string` | Field within the section (e.g. `HOST`); equals `key` when section is empty |
| `value` | `unknown` | Default or live value, depending on `useCurrentValues` |
| `isSecret` | `boolean` | `true` if the field was wrapped with `Secret()` |
| `description` | `string \| undefined` | From Zod `.describe()` annotation |

---

### Error classes

All errors extend `ConfigError`, which in turn extends `BaseError` from `@pawells/typescript-common`.

| Class | Error code | Thrown when |
|---|---|---|
| `ConfigError` | `CONFIG_ERROR` | General configuration error; base class for all others |
| `ConfigRegistrationError` | `CONFIG_REGISTRATION_ERROR` | A key is registered a second time with a different schema |
| `ConfigNotSetError` | `CONFIG_NOT_SET_ERROR` | `Get()` is called for a key with no value in the requested tier |
| `ConfigNotRegisteredError` | `CONFIG_NOT_REGISTERED` | `Get()`, `Set()`, or `GetSchema()` is called for an unregistered key |
| `ConfigValidationError` | `CONFIG_VALIDATION_ERROR` | A value fails its Zod schema at `Register()`, `Set()`, or `Get()` time |

```typescript
import { ConfigError, ConfigNotRegisteredError, ConfigNotSetError, ConfigValidationError } from '@pawells/config';

try {
    const value = ConfigManager.Get('MISSING_KEY');
} catch (error) {
    if (error instanceof ConfigNotRegisteredError) {
        // Key was never registered
    } else if (error instanceof ConfigNotSetError) {
        // Key is registered but has no value in the requested tier
    } else if (error instanceof ConfigValidationError) {
        // Value failed schema validation; check error.cause for Zod details
    } else if (error instanceof ConfigError) {
        // Any other configuration error
    }
}
```

---

### Schema constants and utilities

| Export | Description |
|---|---|
| `CONFIG_VALUES_TYPES_SCHEMA` | Zod union schema accepting all supported config value types |
| `AssertConfigValueType(value)` | Asserts that `value` is a `TConfigValueTypes`; throws `ZodError` otherwise |
| `CONFIG_PROVIDER_OPTIONS_SCHEMA` | Zod schema for `{ name: string }` base provider options |
| `TConfigProviderOptions` | Inferred type of `CONFIG_PROVIDER_OPTIONS_SCHEMA` |
| `AssertConfigProviderOptions(options)` | Asserts conformance; throws `ZodError` otherwise |
| `ValidateConfigProviderOptions(options)` | Returns `true` if options conform; `false` otherwise |
| `CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA` | Zod schema for `{ useCurrentValues?: boolean }` |
| `TConfigProviderSaveOptions` | Inferred type of `CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA` |

## License

MIT — See [LICENSE](../../LICENSE) for details.
