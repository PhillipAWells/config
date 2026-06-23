# Config JSON Provider

[![CI](https://github.com/PhillipAWells/config/actions/workflows/ci.yml/badge.svg)](https://github.com/PhillipAWells/config/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@pawells/config-provider-json.svg)](https://www.npmjs.com/package/@pawells/config-provider-json)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Description

A configuration provider for `@pawells/config` that reads JSON files and flattens nested objects into fully-qualified configuration keys. Implements both `IConfigProvider` (async read) and `ISaveableConfigProvider` (async write), making it suitable for loading configuration from JSON files and saving configuration snapshots or templates.

## Requirements

- **Node.js**: 22.0.0 or later
- **TypeScript**: 6.0.0 or later (if consuming from source)
- **@pawells/config**: ^1.0.0 (dependency)
- **zod**: ^4.4.3 (transitive dependency)

## Installation

Install from npm:

```bash
npm install @pawells/config-provider-json
```

Or with yarn:

```bash
yarn add @pawells/config-provider-json
```

Also install the core config package (usually already present):

```bash
npm install @pawells/config
```

## Quick Start

### Basic Usage

```typescript
import { ConfigManager } from '@pawells/config';
import { ConfigJSONProvider } from '@pawells/config-provider-json';

// Create and register the provider
const provider = new ConfigJSONProvider({
  name: 'json',
  path: './config.json',
  required: true
});

await ConfigManager.RegisterProvider(provider);

// Now configuration is available for schema modules
```

### JSON File Format

Nested JSON objects are automatically flattened using `_` as the separator:

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

Flattens to:

```
APP_HOST: "localhost"
APP_PORT: 3000
APP_DEBUG: false
KEYCLOAK_HOST: "keycloak.example.com"
KEYCLOAK_PORT: 8080
```

Only one level of nesting is flattened. Top-level non-object values are kept as-is.

### Saving Configuration

Generate a config template (secrets as `null`):

```typescript
const provider = new ConfigJSONProvider({
  name: 'json',
  path: './config.json'
});

// Generate config.example.json with defaults and blank secrets
await ConfigManager.Save(provider, { path: './config.example.json' });
```

Snapshot current runtime values:

```typescript
await ConfigManager.Save(provider, {
  path: './config.snapshot.json',
  useCurrentValues: true
});
```

## API Reference

### Constructor

```typescript
new ConfigJSONProvider(options: TConfigJSONProviderOptions)
```

**Options:**

- `name` (string, required) — Unique provider name for diagnostics
- `path` (string, optional) — Path to JSON file; defaults to `./config.json`
- `required` (boolean, optional) — When `true` (default `false`), throws if file is missing; when `false`, returns empty config

**Example:**

```typescript
const provider = new ConfigJSONProvider({
  name: 'json',
  path: './config.local.json',
  required: false  // optional file
});
```

### Methods

#### `Load(): Promise<Record<string, unknown>>`

Asynchronously loads and flattens the JSON file. Returns a flat record of fully-qualified key names to values.

- Reads the file asynchronously using `fs/promises`
- Parses JSON and flattens one level of nesting
- Enforces a 10MB size limit (byte-accurate)
- When `required: false`, returns `{}` if the file is missing or unreadable
- When `required: true`, throws the original error

```typescript
const values = await provider.Load();
```

#### `Save(entries, options): Promise<void>`

Asynchronously saves configuration entries to a JSON file.

**Parameters:**

- `entries` (readonly ConfigSaveEntry[]) — All registered config entries from `ConfigManager`
- `options.path` (string, optional) — Output file path; defaults to the configured path
- `options.useCurrentValues` (boolean, optional) — When `true`, write current live values; when `false` (default), write defaults and `null` for secrets

```typescript
await provider.Save(entries, { path: './config.example.json' });
```

#### `static Register(options?): ConfigJSONProvider`

Factory method that creates and registers the provider in one call.

```typescript
ConfigJSONProvider.Register({
  name: 'json',
  path: './config.json',
  required: false
});
```

## Features

- **Async I/O** — Fully asynchronous file operations; does not block the event loop
- **Native Type Preservation** — JSON numbers, booleans, arrays, and nulls are passed directly to validation (not converted to strings)
- **Security** — Path traversal protection, prototype-pollution key skipping, Zod schema validation
- **Size Guard** — Enforces a 10MB limit (byte-accurate) to prevent memory exhaustion from large files
- **Template Generation** — Generates `.env.example`-style templates with secrets blanked for safe committing
- **Snapshot Mode** — Records current live config values for auditing or backup

## Security Considerations

- **No env interpolation** — Unlike `.env` files, JSON values are not interpolated (e.g., `${VAR}` is treated as a literal string)
- **Prototype pollution protection** — Keys like `__proto__`, `constructor`, and `prototype` are silently skipped
- **Path traversal protection** — Paths containing `..` are rejected at construction time
- **Secret handling** — Fields marked with `Secret()` are written as `null` in template mode, preventing accidental secret commits

## Limitations

- Only one level of nesting is flattened (e.g., deeply nested objects are not supported)
- The `_` character is reserved as the nesting separator and may cause ambiguity in key names (e.g., both `SECTION_FIELD` and `SECTION` with a `_FIELD` field will flatten the same)
- No support for JSON comments (standard JSON only)

## Examples

### Load from optional JSON file with defaults

```typescript
import { ConfigManager, RegisterConfigSchema, Secret } from '@pawells/config';
import { ConfigJSONProvider } from '@pawells/config-provider-json';
import { z } from 'zod/v4';

// Register provider FIRST
ConfigJSONProvider.Register({
  name: 'json',
  path: './config.json',
  required: false  // OK if missing
});

// Then define schema
const AppConfig = RegisterConfigSchema(
  'App',
  z.object({
    HOST: z.string().default('localhost'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: Secret(z.string().url().default('')),
  })
);

// Values are loaded: config.json → env overrides → defaults
const host = AppConfig.Get('HOST');
const port = AppConfig.Get('PORT');
```

### Generate example config template

```typescript
const provider = ConfigJSONProvider.Register({
  name: 'json',
  path: './config.json'
});

// Later, at CLI or on-demand
const entries = /* fetch from ConfigManager */;
await provider.Save(entries, {
  path: './config.example.json'
  // useCurrentValues: false (default) → secrets written as null
});
```

## Error Handling

```typescript
import { ConfigError } from '@pawells/config';

try {
  const provider = new ConfigJSONProvider({
    name: 'json',
    path: './config.json',
    required: true
  });
  await ConfigManager.RegisterProvider(provider);
} catch (error) {
  if (error instanceof ConfigError) {
    // Path contains ".." or other schema validation error
    console.error('Configuration error:', error.message);
  } else {
    // File I/O error (file not found, permission denied, etc.)
    console.error('File error:', error);
  }
}
```

## License

MIT — See [LICENSE](../../LICENSE) for details.
