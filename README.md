# Config Workspace

[![CI](https://github.com/PhillipAWells/config/actions/workflows/ci.yml/badge.svg)](https://github.com/PhillipAWells/config/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Description

`@pawells/config-workspace` is an NX monorepo publishing three packages that together provide type-safe, schema-validated configuration management for Node.js applications. Configuration values are validated at registration time using [Zod](https://zod.dev), secret fields are automatically redacted in logs and templates, and a three-tier precedence model (defaults, provider values, runtime overrides) gives applications predictable, composable configuration loading.

| Package | npm | Description |
|---|---|---|
| `@pawells/config` | [![npm](https://img.shields.io/npm/v/@pawells/config)](https://www.npmjs.com/package/@pawells/config) | Core configuration manager: schema factory, secret handling, provider interface, error types. [README](./packages/config/README.md) |
| `@pawells/config-provider-env` | [![npm](https://img.shields.io/npm/v/@pawells/config-provider-env)](https://www.npmjs.com/package/@pawells/config-provider-env) | Environment variable and `.env` file provider. [README](./packages/config-provider-env/README.md) |
| `@pawells/config-provider-json` | [![npm](https://img.shields.io/npm/v/@pawells/config-provider-json)](https://www.npmjs.com/package/@pawells/config-provider-json) | JSON file provider with symlink rejection and path-traversal protection. [README](./packages/config-provider-json/README.md) |

## Requirements

- Node.js `>=22.0.0`
- Yarn Berry 4 (`corepack enable && corepack use yarn@stable`)

## Installation

Install the core package and whichever provider packages your application needs:

```sh
# Core package (required)
yarn add @pawells/config

# Environment variable provider (optional)
yarn add @pawells/config-provider-env

# JSON file provider (optional)
yarn add @pawells/config-provider-json
```

All packages are ESM-only (`"type": "module"`).

## Quick Start

The following example registers an environment variable provider, defines a typed configuration schema, and retrieves a validated value.

```typescript
import { ConfigManager, RegisterConfigSchema } from '@pawells/config';
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';
import { z } from 'zod';

// 1. Register providers BEFORE importing schema modules.
//    Provider values are merged into schemas as they are registered.
await ConfigEnvironmentProvider.Register({ path: '.env' });

// 2. Define and register a schema. The prefix 'APP_' is derived from the name 'App'.
const AppConfig = RegisterConfigSchema('App', z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('localhost'),
}));

// 3. Retrieve validated, typed values.
const port = AppConfig.Get('PORT'); // number
const host = AppConfig.Get('HOST'); // string

console.log(`Listening on ${host}:${port}`);
```

With a `.env` file containing `APP_PORT=8080`, `AppConfig.Get('PORT')` returns `8080` as a `number`, parsed and validated by Zod.

## API Reference

Each package has its own detailed API reference:

| Package | Reference |
|---|---|
| `@pawells/config` | [packages/config/README.md](./packages/config/README.md) |
| `@pawells/config-provider-env` | [packages/config-provider-env/README.md](./packages/config-provider-env/README.md) |
| `@pawells/config-provider-json` | [packages/config-provider-json/README.md](./packages/config-provider-json/README.md) |

## License

MIT — See [LICENSE](./LICENSE) for details.
