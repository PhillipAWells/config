# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [3.0.1] - 2026-06-23

### Fixed

- `@pawells/config-provider-env` and `@pawells/config-provider-json` were published at 3.0.0 with an unresolved `workspace:*` dependency on `@pawells/config` in their npm manifests, causing `yarn install` to fail for external consumers. The publish pipeline now uses `yarn npm publish` instead of `npm publish`, which rewrites workspace protocol references to semver ranges (`^3.0.0`) before uploading the tarball. A CI guard now fails the publish if any `workspace:` token remains in a packed manifest.

---

## [3.0.0] - 2026-06-23

### Breaking Changes

**`ConfigManager.Save()` is now async**

`ConfigManager.Save()` (and the matching `ScopedConfigManager#Save()`) now returns
`Promise<void>`. In v2.x the method was synchronous and fired the underlying provider
write with `void provider.Save(...)` — errors were silently swallowed. In v3 the
method `await`s the provider, propagates errors, and callers must `await` it.

See [Migrating from 2.x to 3.0.0](#migrating-from-2x-to-300) for before/after examples.

---

**`ISaveableConfigProvider` interface removed**

The `ISaveableConfigProvider` interface has been removed from `@pawells/config`.
`Save()` is now part of `IConfigProvider` directly. Custom providers that previously
implemented `ISaveableConfigProvider` must now implement `IConfigProvider` or extend
the `ConfigProvider` abstract base class, both of which include `Save()`.

---

**`ConfigJSONProvider.Register()` is now async**

The static factory method `ConfigJSONProvider.Register()` previously returned a
synchronous `ConfigJSONProvider` and dispatched registration with `void`. It now
returns `Promise<ConfigJSONProvider>` and must be `await`ed.

The instance methods `Load()` and `Save()` were already async in v2.x and are
unchanged in signature.

---

**`LoadOptions` types no longer exported from provider packages**

The types `TConfigJSONProviderLoadOptions` (from `@pawells/config-provider-json`)
and `TConfigENVProviderLoadOptions` (from `@pawells/config-provider-env`) are no
longer part of the public API. These were constructor-level details that leaked into
the exports. Remove any import references to these types; they are no longer needed
at call sites.

---

**JSON provider: malformed JSON now throws `ConfigError` instead of `SyntaxError`**

In v2.x, a malformed JSON config file caused `JSON.parse()` to throw a raw
`SyntaxError` that propagated directly to the caller. In v3, the JSON provider
catches the `SyntaxError` and re-throws it as a `ConfigError` with the original
error attached as `cause`. Code that catches `SyntaxError` to detect parse failures
must be updated to catch `ConfigError` instead.

---

**Both providers reject symlinked paths**

`ConfigJSONProvider.Load()` and `ParseDotEnvFileAsync()` (used internally by
`ConfigEnvironmentProvider.Load()`) now detect and reject symlinks:

- The JSON provider opens the file with `O_NOFOLLOW` to atomically reject a
  symlinked final path component, and canonicalizes the parent directory with
  `fs.realpath()` to catch symlinked ancestor directories. Both conditions throw
  `ConfigError`.
- The env provider calls `fs.lstat()` and throws `ConfigError` when the `.env`
  path is a symbolic link.

Applications that pointed either provider at a symlink path (for example, a
Docker secrets mount) must switch to the resolved physical path.

---

**Both providers reject `..` path-traversal sequences**

Both `ConfigJSONProvider` and `ConfigEnvironmentProvider` validate their `path`
options against a Zod schema that rejects any path containing `..` directory
traversal sequences. Previously only a constructor-level validation hint existed.
In v3 this is enforced as a hard `ConfigError` at construction time and during
`ParseDotEnvFileAsync()`.

---

**`ConfigEnvironmentProvider.Load()` no longer writes to the console**

In v2.x, non-critical read errors from the `.env` file (permission errors, etc.)
were logged via `console.warn` and then swallowed. In v3, non-critical errors
(ENOENT, EACCES, etc.) are silently skipped — only security rejections (symlink
detected, path traversal) are propagated as a thrown `ConfigError`. Code that
relied on `console.warn` output to observe dotenv load failures must replace that
with an error handler or structured logging around the `Load()` call.

---

**`@pawells/config-provider-env` no longer depends on `@pawells/typescript-common`**

The `@pawells/typescript-common` peer was removed from `@pawells/config-provider-env`.
If your application installed `@pawells/typescript-common` transitively through
the env provider and uses it directly, add an explicit dependency on
`@pawells/typescript-common` to your own `package.json`.

---

### Added

- **`ScopedConfigManager`** — Instance-based configuration manager with independent
  state. Mirrors the static `ConfigManager` API as instance methods, enabling test
  isolation (one instance per test) and multi-tenant scenarios (separate config
  trees per tenant or feature flag context) without touching the global singleton.

### Changed

- `ConfigManager.Save()` and `ScopedConfigManager#Save()` now `await` the provider
  write and propagate errors instead of firing and forgetting.
- `ConfigJSONProvider.Register()` is now `async` and returns
  `Promise<ConfigJSONProvider>`.
- `ConfigEnvironmentProvider.Load()` propagates `ConfigError` security rejections
  (symlink, path traversal) and silently skips all other file read errors instead
  of logging them.
- `SerializeConfigValue()` (internal to `@pawells/config-provider-env`) now handles
  plain objects by JSON-stringifying them. `Date` values continue to serialize as
  bare ISO 8601 strings via `Date.prototype.toISOString()`.
- `ConfigManager.Save()` now accepts `IConfigProvider` (the unified interface)
  instead of the removed `ISaveableConfigProvider`.
- Provider validation warnings are now delivered via a configurable
  `SetValidationWarningHandler()` callback instead of hardcoded `console.warn` calls.
- Default values use `structuredClone()` instead of a shallow spread, preventing
  caller mutation of registered defaults.
- Namespace key lookups are now O(1) via an internal `Map` (was O(n) iteration).

### Fixed

- `ConfigJSONProvider.Load()` now throws `ConfigError` (with `cause`) on malformed
  JSON instead of propagating a raw `SyntaxError`.
- `ConfigJSONProvider.Load()` throws `ConfigError` when the config file path or any
  ancestor directory is a symbolic link.
- `ConfigEnvironmentProvider.Load()` throws `ConfigError` when the `.env` path is a
  symbolic link, instead of silently continuing with `process.env` values only.
- Constructor error handling in `ConfigManager` now always throws `ConfigError`;
  the previous string-fallback path has been removed.
- A section-collision guard in `ConfigJSONProvider` prevents duplicate section
  initialization when multiple keys share the same namespace prefix.

---

## Migrating from 2.x to 3.0.0

### 1. Await `ConfigManager.Save()`

`Save()` is now async. Add `await` wherever it is called.

```ts
// Before (v2.x) — synchronous, errors silently swallowed
import { ConfigManager } from '@pawells/config';
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';

const provider = new ConfigEnvironmentProvider({ name: 'env', path: '.env' });
ConfigManager.Save(provider, { path: '.env.example' });

// After (v3.0.0) — async, errors propagate
import { ConfigManager } from '@pawells/config';
import { ConfigEnvironmentProvider } from '@pawells/config-provider-env';

const provider = new ConfigEnvironmentProvider({ name: 'env', path: '.env' });
await ConfigManager.Save(provider, { path: '.env.example' });
```

### 2. Replace `ISaveableConfigProvider` with `IConfigProvider` or `ConfigProvider`

`ISaveableConfigProvider` no longer exists. Custom providers should implement
`IConfigProvider` or extend `ConfigProvider`, both of which now include `Save()`.

```ts
// Before (v2.x)
import type { ISaveableConfigProvider, ConfigSaveEntry, SaveOptions } from '@pawells/config';

class MyProvider implements ISaveableConfigProvider {
  readonly Name = 'my-provider';

  async Load(): Promise<Record<string, unknown>> {
    return {};
  }

  async Save(entries: readonly ConfigSaveEntry[], options?: SaveOptions): Promise<void> {
    // write entries
  }
}

// After (v3.0.0) — implement IConfigProvider directly
import type { IConfigProvider, ConfigSaveEntry, SaveOptions } from '@pawells/config';

class MyProvider implements IConfigProvider {
  readonly Name = 'my-provider';

  async Load(): Promise<Record<string, unknown>> {
    return {};
  }

  async Save(entries: readonly ConfigSaveEntry[], options?: SaveOptions): Promise<void> {
    // write entries
  }
}
```

Alternatively, extend `ConfigProvider` from `@pawells/config`:

```ts
import { ConfigProvider } from '@pawells/config';
import type { ConfigSaveEntry, SaveOptions } from '@pawells/config';

class MyProvider extends ConfigProvider {
  async Load(): Promise<Record<string, unknown>> {
    return {};
  }

  async Save(entries: readonly ConfigSaveEntry[], options?: SaveOptions): Promise<void> {
    // write entries
  }
}
```

### 3. Await `ConfigJSONProvider.Register()`

The static factory now returns a promise.

```ts
// Before (v2.x) — synchronous, fire-and-forget registration
import { ConfigJSONProvider } from '@pawells/config-provider-json';

ConfigJSONProvider.Register({ name: 'json', path: './config.json' });

// After (v3.0.0) — async, registration completes before proceeding
import { ConfigJSONProvider } from '@pawells/config-provider-json';

await ConfigJSONProvider.Register({ name: 'json', path: './config.json' });
```

### 4. Remove imports of `LoadOptions` types

```ts
// Before (v2.x)
import type { TConfigJSONProviderLoadOptions } from '@pawells/config-provider-json';
import type { TConfigENVProviderLoadOptions } from '@pawells/config-provider-env';

// After (v3.0.0) — remove these imports; pass options inline or omit entirely
```

### 5. Update `SyntaxError` catches to `ConfigError`

```ts
// Before (v2.x)
import { ConfigJSONProvider } from '@pawells/config-provider-json';

try {
  await ConfigManager.RegisterProvider(new ConfigJSONProvider({ name: 'json', path: './config.json', required: true }));
} catch (error) {
  if (error instanceof SyntaxError) {
    console.error('Bad JSON:', error.message);
  }
}

// After (v3.0.0) — catch ConfigError; original SyntaxError is on error.cause
import { ConfigError } from '@pawells/config';
import { ConfigJSONProvider } from '@pawells/config-provider-json';

try {
  await ConfigManager.RegisterProvider(new ConfigJSONProvider({ name: 'json', path: './config.json', required: true }));
} catch (error) {
  if (error instanceof ConfigError) {
    console.error('Config error:', error.message, error.cause);
  }
}
```

### 6. Replace symlink paths with resolved physical paths

If your deployment uses symlinks for config files (for example, Docker secrets
or environment-specific overlays), resolve the real path before passing it to
either provider:

```ts
// Before (v2.x) — symlinks were followed silently
import { ConfigJSONProvider } from '@pawells/config-provider-json';

await ConfigManager.RegisterProvider(
  new ConfigJSONProvider({ name: 'json', path: '/run/secrets/config.json' })
);

// After (v3.0.0) — resolve the real path first
import { realpath } from 'node:fs/promises';
import { ConfigJSONProvider } from '@pawells/config-provider-json';

const resolvedPath = await realpath('/run/secrets/config.json');
await ConfigManager.RegisterProvider(
  new ConfigJSONProvider({ name: 'json', path: resolvedPath })
);
```

---

[Unreleased]: https://github.com/PhillipAWells/config/compare/v3.0.1...HEAD
[3.0.1]: https://github.com/PhillipAWells/config/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/PhillipAWells/config/releases/tag/v3.0.0
