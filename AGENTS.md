# @pawells/config-workspace — Agent Reference

Primary reference for all AI agents working in this repository. CLAUDE.md delegates entirely to this file.

---

## 1. Project Overview

**Purpose:** NX monorepo publishing type-safe configuration management packages for Node.js.

- **GitHub:** https://github.com/PhillipAWells/config
- **Author:** Phillip Aaron Wells
- **License:** MIT
- **Publishing:** All packages are public on npm under the `@pawells/` scope.

### Packages

All packages are at v3.0.0, `"type": "module"` (ESM only), Node >=22.0.0.

| NX project name | npm package | Description |
|---|---|---|
| `config` | `@pawells/config` | Core type-safe configuration manager: schema factory (Zod), secret handling, provider interface, error types |
| `config-provider-env` | `@pawells/config-provider-env` | Environment variable + dotenv provider for `@pawells/config` |
| `config-provider-json` | `@pawells/config-provider-json` | JSON file provider for `@pawells/config` |

### Shared Runtime Dependencies

| Package | Version range |
|---|---|
| `@pawells/typescript-common`* | `^3.0.5` |
| `tslib` | `^2.8.1` |
| `zod` | `^4.4.3` |

* Used by `@pawells/config` and `@pawells/config-provider-json`; not a dependency of `@pawells/config-provider-env` (dropped in v3.0.0).

`config-provider-env` and `config-provider-json` depend on `@pawells/config` via `workspace:*`.

---

## 2. Build & Test Commands

### Prerequisites

```sh
corepack enable
yarn install          # local dev
yarn install --immutable  # CI
```

Node requirement: `>=22.0.0`. `.nvmrc` pins Node 24.

### Workspace-Wide Commands

| Task | Command |
|---|---|
| Typecheck | `yarn typecheck` |
| Lint | `yarn lint` |
| Test | `yarn test` |
| Test with coverage | `yarn test:coverage` |
| Build | `yarn build` |
| Clean | `yarn clean` |

All workspace scripts delegate to `yarn nx run-many --target=<target> --all`.

### Single-Package Commands

Replace `<project>` with the NX project name: `config`, `config-provider-env`, or `config-provider-json`.

| Task | Command |
|---|---|
| Typecheck | `yarn nx typecheck <project>` |
| Lint | `yarn nx lint <project>` |
| Test | `yarn nx test <project>` |
| Build | `yarn nx build <project>` |
| Clean | `yarn nx clean <project>` |
| Publish | `yarn nx publish <project>` |

### Single Test File

```sh
yarn nx test <project> -- <path/to/file.spec.ts>
# Example:
yarn nx test config -- src/manager.spec.ts
```

### Local Registry (Verdaccio)

A local npm registry runs on port 4873 for pre-publish verification:

```sh
yarn nx local-registry
```

### NX Runtime Flags

NX daemon is disabled (`disableDaemon: true`). Cloud connectivity is off (`neverConnectToCloud: true`). Do not pass `--daemon` flags.

---

## 3. Code Style & Conventions

### TypeScript

- Version: `~6.0.0`
- Target: `ES2022`; module/moduleResolution: `nodenext`
- All packages are strict (`strict: true`) with `noUnusedLocals`, `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`
- `isolatedModules: true` — every file must be independently compilable
- No `any` — `@typescript-eslint/no-explicit-any` is an error
- No non-null assertions — `@typescript-eslint/no-non-null-assertion` is an error
- Prefix unused variables with `_` to suppress `no-unused-vars`

### Imports

- Use `.js` extensions on all relative imports (even when the source file is `.ts`)
- Four import groups in order: Node built-ins, external packages, workspace packages, relative imports
- Use `import type` for type-only imports (`@typescript-eslint/consistent-type-imports` enforced)

### ESLint Rules (enforced, not advisory)

| Rule | Setting |
|---|---|
| Indentation | Tabs (`@stylistic/indent: tab`) |
| Quotes | Single quotes, `avoidEscape: true` |
| Semicolons | Required |
| Trailing commas | None (`comma-dangle: never`) |
| `no-explicit-any` | Error |
| `no-floating-promises` | Error |
| `no-non-null-assertion` | Error |
| `no-unused-vars` | Error (prefix `_` to suppress) |
| `no-console` | Error |

### JSDoc

Required on all exported symbols. Format:

```ts
/**
 * Brief description.
 *
 * @param name - Description of the parameter.
 * @returns Description of the return value.
 * @throws {ErrorType} When this condition occurs.
 * @example
 * ```ts
 * exampleUsage();
 * ```
 */
```

---

## 4. Project Structure

### Monorepo Layout

```
/
├── .devcontainer/          # Dev container config (devcontainer.json, Dockerfile, postCreate.sh)
├── .github/workflows/      # ci.yml, publish.yml
├── .husky/                 # pre-commit, commit-msg hooks
├── packages/
│   ├── config/             # @pawells/config
│   ├── config-provider-env/  # @pawells/config-provider-env
│   └── config-provider-json/ # @pawells/config-provider-json
├── eslint.config.mjs       # Flat ESLint config (v9+), workspace-wide
├── nx.json                 # NX workspace configuration
├── package.json            # Workspace root (private: true)
├── tsconfig.base.json      # Root baseline compiler options
├── tsconfig.json           # Root references (files: [])
└── vitest.workspace.ts     # Globs all per-package vitest.config.{ts,mts}
```

### Per-Package Structure

```
packages/<name>/
├── src/
│   ├── index.ts            # Public exports
│   ├── <module>.ts         # Implementation
│   └── <module>.spec.ts    # Co-located tests
├── LICENSE
├── package.json
├── project.json            # NX per-package targets (publish, clean)
├── tsconfig.json           # References tsconfig.lib.json + tsconfig.spec.json
├── tsconfig.lib.json       # Build config (rootDir: src, outDir: dist)
├── tsconfig.spec.json      # Test config (customConditions: ["local"])
└── vitest.config.mts
```

### Package Source Modules

**`@pawells/config` (`packages/config/src/`)**

| File | Purpose |
|---|---|
| `errors.ts` | Custom error types |
| `manager.ts` | Configuration manager |
| `provider.ts` | Provider interface |
| `schema.factory.ts` | Zod-based schema factory |
| `secret.ts` | Secret value handling |

**`@pawells/config-provider-env` (`packages/config-provider-env/src/`)**

| File | Purpose |
|---|---|
| `environment-provider.ts` | Environment variable + dotenv provider implementation |
| `env-utils.ts` | Environment variable utilities |

**`@pawells/config-provider-json` (`packages/config-provider-json/src/`)**

| File | Purpose |
|---|---|
| `json-provider.ts` | JSON file provider implementation |

### Exports Map

Each package uses the `"local"` condition for source imports during development/testing and `"import"`/`"default"` for the built output:

```json
{
  ".": {
    "local": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  }
}
```

`tsconfig.spec.json` sets `customConditions: ["local"]` so tests resolve directly to source.

---

## 5. Testing Instructions

### Framework

Vitest `~4.1.0` with `@vitest/coverage-v8 ~4.1.0`. Per-package config: `vitest.config.mts`.

### Default Settings (per package)

- `watch: false`
- `globals: true`
- `environment: node`
- Include pattern: `{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`

### Test Commands

| Scope | Command |
|---|---|
| All packages | `yarn test` |
| All packages with coverage | `yarn test:coverage` |
| Single package | `yarn nx test <project>` |
| Single package with coverage | `yarn nx test <project> -- --coverage` |
| Single file | `yarn nx test <project> -- <path/to/file.spec.ts>` |

### Coverage Requirements

All four metrics must be at or above **80%** for every package:

| Metric | Threshold |
|---|---|
| Lines | 80% |
| Statements | 80% |
| Branches | 80% |
| Functions | 80% |

Coverage output is written to `./test-output/vitest/coverage` within each package directory.

### Test Conventions

- Test files are co-located with source as `<module>.spec.ts` inside `src/`
- The `test` target depends on `^build` — packages are built before tests run
- The test pool uses `forks` with `maxForks: 2` and `fileParallelism: false`
- Do not use `--watch` in CI or scripted runs

---

## 6. Security & Commit Guidelines

### Files Never to Commit

- `.env`, `.env.*`, any file containing secrets or credentials
- `node_modules/`
- `dist/` (built output — generated by CI)
- `*.tsbuildinfo`
- `tmp/` (local registry storage)
- Any file matching `.gitignore`

### Branch Naming

| Branch | Purpose |
|---|---|
| `main` | Protected default branch; only merged into via squash PR |
| `development/*` | Active development (current: `development/3.0`) |

Do not commit directly to `main`.

### Commit Message Format

Conventional Commits:

```
<type>(<scope>): <subject>

[optional body]
```

Common types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `build`, `ci`.

Examples:

```
feat(config): add support for nested schema validation
fix(config-provider-env): handle missing dotenv file gracefully
chore: update vitest to 4.1.0
```

### CRITICAL: Co-Authored-By Is Rejected

> **The `commit-msg` hook rejects any commit containing a `Co-Authored-By` line.**

This is enforced by `.husky/commit-msg` and will cause the commit to fail with a hard error. This applies to AI agents, tools, and humans alike.

- Do NOT append `Co-Authored-By:` trailers to any commit message
- Do NOT use `git commit` flags or templates that inject co-author lines
- If a commit is rejected for this reason, remove the trailer and recommit

### Merge Strategy

Squash merge only. All commits on a PR are squashed into a single commit on `main`. Write the squash commit message to Conventional Commits standard.

### Version Tags

Tags in the format `v<semver>` (e.g., `v2.4.0`) trigger the publish pipeline. Do not create version tags manually unless publishing is intended.

### GitHub Actions Version Pinning

GitHub Actions in CI/CD workflows (`.github/workflows/*.yml`) MUST be pinned to the **latest major version tags** (e.g. `actions/checkout@v6`, `actions/setup-node@v6`). Do NOT pin actions to full commit SHAs.

- Keeps workflow files readable and maintainable.
- Major-tag pins automatically receive patch/minor updates (including security fixes) from the action publisher.
- Dependabot (github-actions ecosystem) manages major version bumps via PRs, so SHA pinning is unnecessary.
- Always use the latest available major version tag for each action.

---

## 7. Development Workflow & When Stuck

### Before Making Changes

1. Run `yarn typecheck` and `yarn lint` to establish a clean baseline.
2. Read `tsconfig.lib.json` and `tsconfig.spec.json` in the target package before modifying TypeScript configuration.
3. Check `packages/<name>/project.json` for any custom NX targets before assuming the workspace defaults apply.

### After Making Changes

1. Run `yarn lint` — fix all ESLint errors before moving on.
2. Run `yarn typecheck` — fix all TypeScript errors.
3. Run `yarn test` — fix any broken tests. Check coverage if adding new code.
4. Run `yarn build` before opening a PR to verify the build is clean.

### Proposing Changes

- For changes affecting public API surface (exports from any `index.ts`), treat as potentially breaking and note it explicitly.
- For changes to shared build config (`tsconfig.base.json`, `eslint.config.mjs`, `nx.json`, `vitest.workspace.ts`), note that all three packages are affected.
- For dependency changes, update the correct `package.json` (workspace root for dev tools, per-package for runtime dependencies).

### Breaking Changes

A breaking change is any modification that:
- Removes or renames an exported symbol
- Changes a function signature in a non-backward-compatible way
- Raises the minimum Node version
- Changes the module format

Breaking changes require a major version bump.

### When Stuck

- **Type errors from `@pawells/config` in a provider package:** the provider's `tsconfig.spec.json` must have `customConditions: ["local"]` to resolve `@pawells/config` to its source. Verify this is set.
- **NX target not found:** check `project.json` in the package directory. Some targets (e.g., `publish`, `clean`) are defined there rather than inferred by NX plugins.
- **Tests not running:** the `test` target depends on `^build`. Run `yarn build` first if the build output is stale or missing.
- **Hook rejects commit:** if the pre-commit hook fails, fix lint or typecheck errors and stage again. If the commit-msg hook rejects, remove any `Co-Authored-By` lines from the message.
- **Escalate to the human** when: a change requires publishing a new version, a CI secret needs updating, or a breaking change decision requires product judgment.
