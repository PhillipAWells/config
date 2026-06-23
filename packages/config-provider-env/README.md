# @pawells/config-provider-env

[![CI](https://github.com/PhillipAWells/config/actions/workflows/ci.yml/badge.svg)](https://github.com/PhillipAWells/config/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@pawells/config-provider-env.svg)](https://www.npmjs.com/package/@pawells/config-provider-env)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Environment variable and dotenv file configuration provider for [@pawells/config](https://github.com/pawells/config).

## Description

`@pawells/config-provider-env` is a configuration provider that integrates with `@pawells/config` to load settings from environment variables and `.env` files.

The provider merges environment variables from `process.env` with values parsed from a `.env` file (if present), with the dotenv file taking precedence. All values are intelligently parsed — JSON-encoded booleans, numbers, arrays, and `null` are converted to their native JavaScript types, while plain strings remain unchanged. For persistence, the provider can save configuration snapshots to `.env` files in template or current-values mode, with automatic handling of secrets and inline documentation.

This makes it ideal for local development workflows and containerized deployments where configuration is managed through environment variables.

## Requirements

- **Node.js** ≥ 22.0.0
- **TypeScript** ≥ 5.0 (for development)
- **@pawells/config** — the parent config manager package

## Installation

Using npm:
```bash
npm install @pawells/config-provider-env @pawells/config
```

Using Yarn:
```bash
yarn add @pawells/config-provider-env @pawells/config
```

Using pnpm:
```bash
pnpm add @pawells/config-provider-env @pawells/config
```

## Quick Start

### 1. Register the provider

```typescript
import { ConfigManager } from '@pawells/config';
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';

// Register the environment provider
const envProvider = await ConfigEnvironmentProvider.Register({
  name: 'environment',
  path: './.env'
});

// Now ConfigManager.Get() will include values from process.env and .env
```

### 2. Define your configuration schema

```typescript
import { z } from 'zod/v4';
import { ConfigManager } from '@pawells/config';

ConfigManager.RegisterConfigSchema(
  z.object({
    DATABASE_URL: z.string().describe('PostgreSQL connection string'),
    PORT: z.coerce.number().default(3000).describe('Server port'),
    DEBUG: z.boolean().default(false)
  })
);

// Values are resolved from registered providers
const dbUrl = ConfigManager.Get('DATABASE_URL');
const port = ConfigManager.Get('PORT');
```

### 3. Load and save configurations

```typescript
// Load configuration
await envProvider.Load();

// Generate a template .env file with secrets blanked
await ConfigManager.Save(envProvider, {
  path: '.env.example'
});

// Snapshot current runtime values
await ConfigManager.Save(envProvider, {
  path: '.env.snapshot',
  useCurrentValues: true
});
```

## API Reference

### ConfigEnvironmentProvider

A configuration provider that extends the `@pawells/config` async provider contract.

#### Constructor

```typescript
new ConfigEnvironmentProvider(options: TConfigENVProviderOptions)
```

**Parameters:**
- `options` — Provider configuration object
  - `name: string` — Unique provider identifier (default: `'environment'`)
  - `path: string` — Path to the `.env` file to load (default: `.env` in current working directory)

**Example:**
```typescript
const provider = new ConfigEnvironmentProvider({
  name: 'my-env',
  path: '.env.local'
});
```

#### Methods

##### `Load(): Promise<Record<string, unknown>>`

Loads configuration values from `process.env` and optionally a `.env` file.

**Behavior:**
- Reads all entries from `process.env` first
- If `path` is configured, reads and parses the `.env` file, with values overwriting environment variables
- All values are passed through `ParseEnvVarValue()` to convert JSON-encoded types
- If the `.env` file cannot be read (missing, permission denied, etc.), the file is skipped and only `process.env` is returned; errors are logged via `console.warn`

**Returns:**
- A record mapping config keys to their parsed values

**Example:**
```typescript
// process.env = { KEYCLOAK_HOST: 'prod.example.com' }
// .env        = { KEYCLOAK_HOST: 'localhost', KEYCLOAK_PORT: '8080' }
const provider = new ConfigEnvironmentProvider({
  name: 'env',
  path: '.env'
});
const config = await provider.Load();
// → { KEYCLOAK_HOST: 'localhost', KEYCLOAK_PORT: 8080 }
```

##### `Save(entries: readonly ConfigSaveEntry[], options?: TConfigENVProviderSaveOptions): Promise<void>`

Saves configuration values to a `.env`-format file.

**Parameters:**
- `entries` — Config entries supplied by `ConfigManager.Save()`
- `options` — Optional save behavior
  - `path: string` — Output file path; overrides `this.options.path` if provided
  - `useCurrentValues: boolean` — When `true`, write current live values; when `false` (default), write registered defaults

**Behavior:**
- In template mode (default): secrets are always written with blank values, suitable for generating `.env.example`
- In current-values mode: all values including secrets are written with their live values
- Descriptions from Zod `.describe()` annotations are emitted as comment lines before each key

**Example:**
```typescript
const provider = new ConfigEnvironmentProvider({
  name: 'env',
  path: '.env'
});

// Generate a .env.example template
await ConfigManager.Save(provider, { path: '.env.example' });

// Snapshot current runtime config
await ConfigManager.Save(provider, {
  path: '.env.snapshot',
  useCurrentValues: true
});
```

##### `static Register(options?: Partial<TConfigENVProviderOptions>): Promise<ConfigEnvironmentProvider>`

Creates a provider instance and registers it with `ConfigManager`.

**Parameters:**
- `options` — Optional partial provider configuration; unspecified fields use schema defaults

**Returns:**
- A promise resolving to the registered provider instance

**Example:**
```typescript
const envProvider = await ConfigEnvironmentProvider.Register({
  path: '.env.production'
});
```

### Type Definitions

#### `TConfigENVProviderOptions`

```typescript
type TConfigENVProviderOptions = {
  name: string;     // Default: 'environment'
  path: string;     // Default: '.env' in cwd
}
```

#### `TConfigENVProviderLoadOptions`

Currently reserved for future use; an empty object may be passed.

#### `TConfigENVProviderSaveOptions`

```typescript
type TConfigENVProviderSaveOptions = {
  path?: string;
  useCurrentValues?: boolean;  // Default: false
}
```

### Utility Functions

All utility functions are exported for advanced use cases (e.g., parsing env files outside the provider).

#### `ParseEnvVarValue(envVarValue: string): unknown`

Intelligently parses an environment variable string to its native JavaScript type.

- Attempts `JSON.parse()` for encoded values: booleans (`'true'`, `'false'`), numbers, arrays, and `null`
- Falls back to returning the original string if JSON parsing fails
- Uses a fast-path optimization to skip parsing for plain strings

**Example:**
```typescript
ParseEnvVarValue('true')        // → true (boolean)
ParseEnvVarValue('42')          // → 42 (number)
ParseEnvVarValue('["a","b"]')   // → ['a', 'b'] (string[])
ParseEnvVarValue('hello')       // → 'hello' (string, unchanged)
```

#### `ParseDotEnvFile(path: string): Record<string, string>`

Parses a `.env` file from disk into a flat key/value record.

**Processing rules:**
- Lines starting with `#` (after whitespace trimming) are comments and are skipped
- Blank lines are skipped
- Lines with `=` are split on the first `=`; key is trimmed; value is trimmed and surrounding quotes are stripped
- Inline comments (e.g., `KEY=value # comment`) are stripped from unquoted values
- Windows-style `\r\n` line endings are normalized
- Paths containing `..` traversal sequences are rejected

**Returns:**
- A record mapping keys to their raw string values

**Throws:**
- `ConfigError` — When the path contains `..` directory traversal sequences
- `Error` — When the file cannot be read (e.g., not found, permission denied)

**Example:**
```typescript
// .env contents:
// # Database config
// HOST=localhost
// PORT=3000
// SECRET="my-token"
const values = ParseDotEnvFile('./.env');
// → { HOST: 'localhost', PORT: '3000', SECRET: 'my-token' }
```

#### `SerializeConfigValue(value: unknown): string`

Serializes a configuration value to its `.env` string representation.

**Conversion rules:**
- `null` or `undefined` → `''` (blank)
- Arrays → JSON-stringified (e.g., `["a","b"]`)
- `Date` → ISO 8601 string
- All other values → `String(value)`

**Example:**
```typescript
SerializeConfigValue('hello')           // → 'hello'
SerializeConfigValue(42)                // → '42'
SerializeConfigValue(['a', 'b'])        // → '["a","b"]'
SerializeConfigValue(new Date('2024-01-01T00:00:00.000Z'))
// → '2024-01-01T00:00:00.000Z'
SerializeConfigValue(null)              // → ''
```

### Assertion & Validation Functions

For runtime validation of options objects:

- `AssertConfigENVProviderOptions(options: unknown): asserts options is TConfigENVProviderOptions`
- `ValidateConfigENVProviderOptions(options: unknown): boolean`
- `AssertConfigENVProviderLoadOptions(options: unknown): asserts options is TConfigENVProviderLoadOptions`
- `ValidateConfigENVProviderLoadOptions(options: unknown): boolean`
- `AssertConfigENVProviderSaveOptions(options: unknown): asserts options is TConfigENVProviderSaveOptions`
- `ValidateConfigENVProviderSaveOptions(options: unknown): boolean`

## License

MIT
