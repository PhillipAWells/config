import { z } from 'zod/v4';
import { GetErrorMessage } from '@pawells/typescript-common';
import { ConfigRegistrationError, ConfigNotRegisteredError, ConfigError, ConfigNotSetError, ConfigValidationError } from './errors.js';
import { IsMarkedSecret, traverseSchemaToBase } from './secret.js';
import type { ISaveableConfigProvider, ISyncConfigProvider, SaveOptions, ConfigSaveEntry, ConfigProvider } from './provider.js';

/**
 * Zod schema for all supported configuration value types.
 * Accepts string, number, boolean, Date, string[], number[], boolean[], and undefined — nullable and optional.
 */
export const CONFIG_VALUES_TYPES_SCHEMA = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.date(),
	z.array(z.string()),
	z.array(z.number()),
	z.array(z.boolean()),
	z.undefined()
]).nullable().optional();

/**
 * Asserts that a value conforms to the supported configuration value types.
 *
 * @param value - The value to assert
 * @throws {ZodError} If the value does not match any supported type
 * @example
 * AssertConfigValueType('hello'); // passes
 * AssertConfigValueType(42);      // passes
 * AssertConfigValueType({});      // throws ZodError
 */
export function AssertConfigValueType(value: unknown): asserts value is TConfigValueTypes {
	CONFIG_VALUES_TYPES_SCHEMA.parse(value);
}

/** Union of all supported configuration value types. */
export type TConfigValueTypes = z.infer<typeof CONFIG_VALUES_TYPES_SCHEMA>;

/** Map of configuration keys to their typed values. */
export type TConfig = Map<string, TConfigValueTypes>;

/** Identifies whether a configuration value comes from the registered default or a runtime override. */
export type TConfigSource = 'DEFAULT' | 'OVERRIDE';

/**
 * Traverses the Zod schema's innerType chain to find a description in globalRegistry.
 *
 * @param schema - Zod schema to inspect
 * @returns - The description string if found, otherwise undefined
 * @internal
 */
function GetFieldDescription(schema: z.ZodTypeAny): string | undefined {
	for (const current of traverseSchemaToBase(schema)) {
		try {
			const meta = z.globalRegistry.get(current);
			if (typeof meta?.description === 'string') {
				return meta.description;
			}
		}
		catch {
			break;
		}
	}

	return undefined;
}

/**
 * Runtime configuration manager with Zod schema validation.
 * Provides a singleton instance to register and retrieve typed configuration values.
 *
 * @example
 * ConfigManager.Register('DATABASE_URL', z.string().url(), 'postgresql://localhost/mydb');
 * ConfigManager.Set('DATABASE_URL', 'postgresql://localhost/mydb');
 * const url = ConfigManager.Get('DATABASE_URL');
 */
export class ConfigManager {
	private static readonly _Schemas: Map<string, z.ZodTypeAny> = new Map();

	// Populated at Registration
	private static readonly _DataDefaults: TConfig = new Map();

	// Overridden at Runtime from various sources
	private static readonly _DataOverrides: TConfig = new Map();

	/**
	 * Raw (unvalidated) values collected from all registered providers.
	 * Stored so that schemas registered after providers can still receive provider values.
	 * Later-registered providers overwrite earlier ones for the same key.
	 * @internal
	 */
	private static readonly _providerRawData: Map<string, unknown> = new Map();

	/**
	 * Validated provider values, ready for merging into the resolved config.
	 * Populated from _providerRawData whenever a schema is registered or a provider is added.
	 * @internal
	 */
	private static readonly _providerValues: TConfig = new Map();

	/**
	 * Maps env-var prefix strings to their section names for save-entry construction.
	 * Populated by {@link RegisterNamespace}, called from RegisterConfigSchema.
	 * Example: 'KEYCLOAK_' → 'KEYCLOAK'
	 * @internal
	 */
	private static readonly _namespaces: Map<string, string> = new Map();

	/**
	 * Cache for the resolved _Data map to avoid rebuilding on every access.
	 * Invalidated whenever data is mutated (Set, Register, Reset, RegisterProvider).
	 * @internal
	 */
	private static _dataCache: Map<string, TConfigValueTypes> | null = null;

	/**
	 * Cache for parsed configuration values, keyed by configuration key.
	 * Avoids re-parsing the same value on repeated Get() calls.
	 * Invalidated when a value is Set() or when Reset() is called.
	 * @internal
	 */
	private static readonly _parsedCache = new Map<string, TConfigValueTypes>();

	/**
	 * Cache for schema metadata (isSecret and description).
	 * Populated at Register() time to avoid traversing the schema chain on every Save() call.
	 * @internal
	 */
	private static readonly _schemaMetaCache = new Map<string, { isSecret: boolean; description: string | undefined }>();

	// Resolved Data
	private static get _Data(): TConfig {
		if (this._dataCache !== null) {
			return this._dataCache;
		}
		const resolved = new Map(this._DataDefaults);
		for (const [key, value] of this._providerValues) {
			resolved.set(key, value);
		}
		for (const [key, value] of this._DataOverrides) {
			resolved.set(key, value);
		}
		this._dataCache = resolved;
		return resolved;
	}

	/**
	 * Reset the singleton instance (for testing).
	 * @internal
	 */
	public static Reset(): void {
		this._Schemas.clear();
		this._DataDefaults.clear();
		this._providerRawData.clear();
		this._providerValues.clear();
		this._DataOverrides.clear();
		this._namespaces.clear();
		this._dataCache = null;
		this._parsedCache.clear();
		this._schemaMetaCache.clear();
	}

	/**
	 * Register a configuration namespace for use when building save entries.
	 *
	 * Records the mapping from `prefix` to `sectionName` so that
	 * {@link Save} can split fully-qualified keys into section and field
	 * components (e.g. `KEYCLOAK_HOST` → section `KEYCLOAK`, field `HOST`).
	 *
	 * Called automatically by `RegisterConfigSchema` — applications do not
	 * normally need to call this directly.
	 *
	 * @param name - Human-readable namespace name (e.g. `'Keycloak'`)
	 * @param prefix - Derived environment variable prefix (e.g. `'KEYCLOAK_'`)
	 *
	 * @example
	 * ```typescript
	 * ConfigManager.RegisterNamespace('Keycloak', 'KEYCLOAK_');
	 * // KEYCLOAK_HOST → section='KEYCLOAK', field='HOST'
	 * ```
	 */
	public static RegisterNamespace(name: string, prefix: string): void {
		this._namespaces.set(prefix, name.toUpperCase());
	}

	/**
	 * Save all registered configuration values via a saveable provider.
	 *
	 * Builds a {@link ConfigSaveEntry} for every registered schema key, then
	 * delegates formatting and file I/O to `provider.save()`.
	 *
	 * In template mode (`useCurrentValues: false`, the default), each entry
	 * carries the registered default value. In current-values mode
	 * (`useCurrentValues: true`), each entry carries the fully resolved live
	 * value (DEFAULT → provider values → OVERRIDE). The `isSecret` flag is
	 * set for fields marked with {@link Secret}; providers are expected to
	 * redact those appropriately in template mode.
	 *
	 * @param provider - A {@link ISaveableConfigProvider} that handles the write
	 * @param options - Output path and save mode
	 * @remarks In `useCurrentValues` mode, keys that cannot be resolved (not set, not registered, or failing validation) are written as blank/undefined without throwing.
	 *
	 * @example
	 * ```typescript
	 * // Write .env.example (template, secrets blank)
	 * ConfigManager.Save(envProvider, { path: '.env.example' });
	 *
	 * // Snapshot current runtime values
	 * ConfigManager.Save(envProvider, { path: '.env', useCurrentValues: true });
	 * ```
	 */
	public static Save(provider: ISaveableConfigProvider, options: SaveOptions): void {
		const useCurrentValues = options.useCurrentValues ?? false;
		const entries: ConfigSaveEntry[] = [];

		for (const [key] of this._Schemas) {
			const meta = ConfigManager._schemaMetaCache.get(key);
			const isSecret = meta?.isSecret ?? false;
			const description = meta?.description;

			// Resolve section / field from namespace registry
			let section = '';
			let field = key;
			for (const [prefix, sectionName] of this._namespaces) {
				if (key.startsWith(prefix)) {
					section = sectionName;
					field = key.slice(prefix.length);
					break;
				}
			}

			let value: unknown;
			if (useCurrentValues) {
				try {
					value = this.Get(key);
				}
				catch (e) {
					if (
						e instanceof ConfigNotSetError
						|| e instanceof ConfigRegistrationError
						|| e instanceof ConfigError
					) {
						value = undefined;
					}
					else {
						throw e;
					}
				}
			}
			else {
				value = this._DataDefaults.get(key);
			}

			entries.push({ key, section, field, value, isSecret, description });
		}

		void provider.Save(entries, options);
	}

	/**
	 * Register a configuration value provider with the manager.
	 *
	 * Immediately calls `provider.load()` to obtain all key/value pairs from the
	 * provider. All raw values are stored in the internal raw-data cache so that
	 * schemas registered after this call can still receive provider values.
	 * For any key that already has a registered schema, the raw value is validated
	 * and the validated result is stored in the provider values tier.
	 *
	 * Provider values occupy the middle precedence tier: they override registered
	 * defaults but are themselves overridden by explicit {@link Set} calls.
	 * When multiple providers supply the same key, the last-registered provider wins.
	 *
	 * @param provider - The {@link IConfigProvider} implementation to register
	 *
	 * @example
	 * ```typescript
	 * import { ConfigEnvironmentProvider, ConfigJSONProvider } from '@pawells/config';
	 *
	 * // Register before importing any schema modules
	 * ConfigManager.RegisterProvider(new ConfigEnvironmentProvider('.env'));
	 * ConfigManager.RegisterProvider(new ConfigJSONProvider('./config.json'));
	 * ```
	 */
	public static async RegisterProvider(provider: ConfigProvider): Promise<void> {
		const values = await provider.Load();

		for (const [key, rawValue] of Object.entries(values)) {
			// Always cache raw value — needed for schemas registered after this provider
			this._providerRawData.set(key, rawValue);

			// If schema already registered, validate and cache the typed value now
			const schema = this._Schemas.get(key);
			if (schema === undefined) continue;

			const result = schema.safeParse(rawValue);
			if (!result.success) {
				// eslint-disable-next-line no-console
				console.warn(`[ConfigManager] Provider "${provider.Name}" value for key "${key}" failed schema validation — using default.`);
				continue;
			}

			// Safe: safeParse succeeds only if result.data matches schema's inferred type,
			// which was validated at RegisterConfigSchema to be TConfigValueTypes
			this._providerValues.set(key, result.data as TConfigValueTypes);
		}
		this._dataCache = null;
	}

	/**
	 * Register a synchronous configuration provider with the manager.
	 * Use this only in contexts that cannot `await`. Most code should prefer
	 * `RegisterProvider()` with an async provider.
	 *
	 * Immediately calls `provider.LoadSync()` to obtain all key/value pairs from the
	 * provider. All raw values are stored in the internal raw-data cache so that
	 * schemas registered after this call can still receive provider values.
	 * For any key that already has a registered schema, the raw value is validated
	 * and the validated result is stored in the provider values tier.
	 *
	 * @param provider - The {@link ISyncConfigProvider} implementation to register
	 *
	 * @example
	 * ```typescript
	 * class MemoryProvider implements ISyncConfigProvider {
	 *   readonly name = 'memory';
	 *   LoadSync() {
	 *     return { MY_KEY: 'value' };
	 *   }
	 * }
	 * ConfigManager.RegisterSyncProvider(new MemoryProvider());
	 * ```
	 */
	public static RegisterSyncProvider(provider: ISyncConfigProvider): void {
		const values = provider.LoadSync();

		for (const [key, rawValue] of Object.entries(values)) {
			// Always cache raw value — needed for schemas registered after this provider
			this._providerRawData.set(key, rawValue);

			// If schema already registered, validate and cache the typed value now
			const schema = this._Schemas.get(key);
			if (schema === undefined) continue;

			const result = schema.safeParse(rawValue);
			if (!result.success) {
				// eslint-disable-next-line no-console
				console.warn(`[ConfigManager] Sync provider "${provider.name}" value for key "${key}" failed schema validation — using default.`);
				continue;
			}

			this._providerValues.set(key, result.data as TConfigValueTypes);
		}
		this._dataCache = null;
	}

	private constructor() { /* intentionally empty */ }

	/**
	 * Register a configuration schema.
	 * @param key - Unique configuration key
	 * @param schema - Zod schema for runtime validation
	 * @param defaultValue - Initial value for the configuration key, must satisfy the schema
	 * @throws {ConfigRegistrationError} If key is already registered
	 * @example
	 * ConfigManager.Register('PORT', z.coerce.number().positive(), 3000);
	 * ConfigManager.Register('JWT_SECRET', z.string().min(32), 'default-secret');
	 */
	public static Register(key: string, schema: z.ZodTypeAny, defaultValue: unknown): void {
		// z.ZodTypeAny: widened to allow schema factory shapes; runtime type constraint
		// is enforced by the Zod schema's own parse() and by AssertConfigValueType elsewhere.
		// Ensure key is unique, but it's fine when the schemas match.
		if (this._Schemas.has(key) && this._Schemas.get(key) !== schema) throw new ConfigRegistrationError(key);
		const result = schema.safeParse(defaultValue);
		if (!result.success) {
			const isSecret = IsMarkedSecret(schema);
			const message = isSecret ? 'Default value does not match the provided schema (value redacted for security).' : 'Default value does not match the provided schema.';
			const options = isSecret ? undefined : { cause: result.error };
			throw new ConfigValidationError(key, message, options);
		}
		const parsed = result.data;

		// Deep-clone mutable types to prevent caller mutation
		const clonedDefault = Array.isArray(parsed)
			? [...parsed]
			: parsed instanceof Date
				? new Date(parsed.getTime())
				: parsed;

		this._Schemas.set(key, schema);
		// Safe: clonedDefault is the parsed result of schema.safeParse(), which succeeded
		this._DataDefaults.set(key, clonedDefault as TConfigValueTypes);
		this._dataCache = null;
		this._parsedCache.delete(key);

		// Cache schema metadata for use in Save()
		ConfigManager._schemaMetaCache.set(key, {
			isSecret: IsMarkedSecret(schema),
			description: GetFieldDescription(schema)
		});

		// Apply any provider value already loaded for this key
		if (this._providerRawData.has(key)) {
			const rawProviderValue = this._providerRawData.get(key);
			const providerResult = schema.safeParse(rawProviderValue);
			if (providerResult.success) {
				// Safe: safeParse succeeds only if providerResult.data matches schema's type
				this._providerValues.set(key, providerResult.data as TConfigValueTypes);
				this._dataCache = null;
			}
		}
	}

	/**
	 * Set a configuration value and validate against its schema.
	 * @param key - Configuration key
	 * @param value - Value to set and validate
	 * @param target - Whether to set the default store or the override store; defaults to `'OVERRIDE'`
	 * @throws {ConfigNotRegisteredError} If schema is not registered for key
	 * @throws {ConfigError} If validation fails
	 * @remarks
	 * When validation fails for a field marked with `Secret()`, the error message and error cause are sanitized to prevent secret values from appearing in error logs or stack traces.
	 * @example
	 * ConfigManager.Set('PORT', 3000);
	 * ConfigManager.Set('JWT_SECRET', process.env.SECRET);
	 */
	public static Set<T extends TConfigValueTypes>(key: string, value: T, target: TConfigSource = 'OVERRIDE'): void {
		const schema = this._Schemas.get(key);
		if (!schema) throw new ConfigNotRegisteredError(key);
		try {
			const parsed = schema.parse(value) as TConfigValueTypes;
			// Safe: Register validates that this schema produces TConfigValueTypes at runtime
			if (target === 'DEFAULT') {
				this._DataDefaults.set(key, parsed);
			}
			else {
				this._DataOverrides.set(key, parsed);
			}
			this._dataCache = null;
			this._parsedCache.delete(key);
		}
		catch (cause) {
			const isSecret = this._schemaMetaCache.get(key)?.isSecret ?? false;
			const message = isSecret ? 'value failed validation (value redacted for security)' : GetErrorMessage(cause);
			const options = isSecret ? undefined : (cause instanceof Error ? cause : undefined);
			throw new ConfigValidationError(key, message, options ? { cause: options } : undefined);
		}
	}

	/**
	 * Retrieve a configuration value by key.
	 * Returns the value parsed by its registered schema.
	 * @param key - Configuration key
	 * @param source - Optional — filter to a specific store (`'DEFAULT'` or `'OVERRIDE'`); omit to return the resolved value (overrides take precedence over defaults)
	 * @returns The typed configuration value
	 * @throws {ConfigNotSetError} If value was not set
	 * @throws {ConfigNotRegisteredError} If schema is not registered
	 * @throws {ConfigError} If validation fails on retrieval
	 * @example
	 * const port = manager.get('PORT'); // Returns number, guaranteed by schema
	 * const secret = manager.get('JWT_SECRET'); // Returns string
	 */
	public static Get(key: string, source?: TConfigSource): TConfigValueTypes {
		const dataSource = source === 'DEFAULT' ? this._DataDefaults : source === 'OVERRIDE' ? this._DataOverrides : this._Data;
		if (!dataSource.has(key)) throw new ConfigNotSetError(key);
		// Safe: has() guard above guarantees presence; stored values match schema types
		const value = dataSource.get(key) as TConfigValueTypes;

		// Only use parsed cache for resolved (non-source-filtered) values
		if (source === undefined && this._parsedCache.has(key)) {
			// has() guard above guarantees presence — use type assertion instead of ! (ESLint: no-non-null-assertion)
			return this._parsedCache.get(key) as TConfigValueTypes;
		}

		const schema = this.GetSchema(key);
		try {
			const rvalue = schema.parse(value) as TConfigValueTypes;
			// Safe: Register validates that this schema produces TConfigValueTypes at runtime

			// Cache the parsed result (only for resolved values, not source-filtered)
			if (source === undefined) {
				this._parsedCache.set(key, rvalue);
			}

			return rvalue;
		}
		catch (cause) {
			throw new ConfigValidationError(key, GetErrorMessage(cause), cause instanceof Error ? { cause } : undefined);
		}
	}

	/**
	 * Retrieve the schema for a configuration key.
	 * @param key - Configuration key
	 * @returns The Zod schema for this configuration
	 * @throws {ConfigNotRegisteredError} If schema is not registered for key
	 * @example
	 * const schema = manager.getSchema('PORT');
	 * const parsed = schema.safeParse(value);
	 */
	public static GetSchema(key: string): z.ZodTypeAny {
		const schema = this._Schemas.get(key);
		if (!schema) throw new ConfigNotRegisteredError(key);
		return schema;
	}
}

/**
 * Instance-based configuration manager for test isolation and multi-tenant scenarios.
 *
 * Unlike the static singleton {@link ConfigManager}, `ScopedConfigManager` maintains
 * independent state in instance fields. This enables isolated configuration contexts
 * without affecting the global singleton or other instances.
 *
 * The public API mirrors `ConfigManager` exactly, but as instance methods instead of
 * static methods. Use this when you need:
 * - Test isolation: each test gets its own config instance
 * - Multi-tenant scenarios: separate configs per tenant
 * - Feature-gating: isolated experimental configs
 *
 * @example
 * ```typescript
 * // Two independent configurations
 * const config1 = new ScopedConfigManager();
 * const config2 = new ScopedConfigManager();
 *
 * config1.Register('PORT', z.coerce.number(), 3000);
 * config2.Register('PORT', z.coerce.number(), 4000);
 *
 * config1.Get('PORT'); // 3000
 * config2.Get('PORT'); // 4000 — independent state
 * ```
 */
export class ScopedConfigManager {
	private readonly _Schemas: Map<string, z.ZodTypeAny> = new Map();
	private readonly _DataDefaults: TConfig = new Map();
	private readonly _DataOverrides: TConfig = new Map();
	private readonly _providerRawData: Map<string, unknown> = new Map();
	private readonly _providerValues: TConfig = new Map();
	private readonly _namespaces: Map<string, string> = new Map();
	private _dataCache: Map<string, TConfigValueTypes> | null = null;
	private readonly _parsedCache = new Map<string, TConfigValueTypes>();
	private readonly _schemaMetaCache = new Map<string, { isSecret: boolean; description: string | undefined }>();

	/**
	 * Resolved configuration data, computed from defaults, provider values, and overrides.
	 * @internal
	 */
	private get _Data(): TConfig {
		if (this._dataCache !== null) {
			return this._dataCache;
		}
		const resolved = new Map(this._DataDefaults);
		for (const [key, value] of this._providerValues) {
			resolved.set(key, value);
		}
		for (const [key, value] of this._DataOverrides) {
			resolved.set(key, value);
		}
		this._dataCache = resolved;
		return resolved;
	}

	/**
	 * Reset this instance (for testing).
	 */
	public Reset(): void {
		this._Schemas.clear();
		this._DataDefaults.clear();
		this._providerRawData.clear();
		this._providerValues.clear();
		this._DataOverrides.clear();
		this._namespaces.clear();
		this._dataCache = null;
		this._parsedCache.clear();
		this._schemaMetaCache.clear();
	}

	/**
	 * Register a configuration namespace for use when building save entries.
	 * @param name - Human-readable namespace name (e.g. `'Keycloak'`)
	 * @param prefix - Derived environment variable prefix (e.g. `'KEYCLOAK_'`)
	 */
	public RegisterNamespace(name: string, prefix: string): void {
		this._namespaces.set(prefix, name.toUpperCase());
	}

	/**
	 * Save all registered configuration values via a saveable provider.
	 * @param provider - A {@link ISaveableConfigProvider} that handles the write
	 * @param options - Output path and save mode
	 */
	public Save(provider: ISaveableConfigProvider, options: SaveOptions): void {
		const useCurrentValues = options.useCurrentValues ?? false;
		const entries: ConfigSaveEntry[] = [];

		for (const [key] of this._Schemas) {
			const meta = this._schemaMetaCache.get(key);
			const isSecret = meta?.isSecret ?? false;
			const description = meta?.description;

			// Resolve section / field from namespace registry
			let section = '';
			let field = key;
			for (const [prefix, sectionName] of this._namespaces) {
				if (key.startsWith(prefix)) {
					section = sectionName;
					field = key.slice(prefix.length);
					break;
				}
			}

			let value: unknown;
			if (useCurrentValues) {
				try {
					value = this.Get(key);
				}
				catch (e) {
					if (
						e instanceof ConfigNotSetError
						|| e instanceof ConfigRegistrationError
						|| e instanceof ConfigError
					) {
						value = undefined;
					}
					else {
						throw e;
					}
				}
			}
			else {
				value = this._DataDefaults.get(key);
			}

			entries.push({ key, section, field, value, isSecret, description });
		}

		void provider.Save(entries, options);
	}

	/**
	 * Register a configuration value provider with this instance.
	 * @param provider - The {@link IConfigProvider} implementation to register
	 */
	public async RegisterProvider(provider: ConfigProvider): Promise<void> {
		const values = await provider.Load();

		for (const [key, rawValue] of Object.entries(values)) {
			// Always cache raw value — needed for schemas registered after this provider
			this._providerRawData.set(key, rawValue);

			// If schema already registered, validate and cache the typed value now
			const schema = this._Schemas.get(key);
			if (schema === undefined) continue;

			const result = schema.safeParse(rawValue);
			if (!result.success) {
				// eslint-disable-next-line no-console
				console.warn(`[ScopedConfigManager] Provider "${provider.Name}" value for key "${key}" failed schema validation — using default.`);
				continue;
			}

			// Safe: safeParse succeeds only if result.data matches schema's inferred type,
			// which was validated at Register to be TConfigValueTypes
			this._providerValues.set(key, result.data as TConfigValueTypes);
		}
		this._dataCache = null;
	}

	/**
	 * Register a synchronous configuration provider with this instance.
	 * @param provider - The {@link ISyncConfigProvider} implementation to register
	 */
	public RegisterSyncProvider(provider: ISyncConfigProvider): void {
		const values = provider.LoadSync();

		for (const [key, rawValue] of Object.entries(values)) {
			// Always cache raw value — needed for schemas registered after this provider
			this._providerRawData.set(key, rawValue);

			// If schema already registered, validate and cache the typed value now
			const schema = this._Schemas.get(key);
			if (schema === undefined) continue;

			const result = schema.safeParse(rawValue);
			if (!result.success) {
				// eslint-disable-next-line no-console
				console.warn(`[ScopedConfigManager] Sync provider "${provider.name}" value for key "${key}" failed schema validation — using default.`);
				continue;
			}

			this._providerValues.set(key, result.data as TConfigValueTypes);
		}
		this._dataCache = null;
	}

	/**
	 * Register a configuration schema.
	 * @param key - Unique configuration key
	 * @param schema - Zod schema for runtime validation
	 * @param defaultValue - Initial value for the configuration key, must satisfy the schema
	 * @throws {ConfigRegistrationError} If key is already registered with a different schema
	 * @throws {ConfigValidationError} If defaultValue does not match the schema
	 */
	public Register(key: string, schema: z.ZodTypeAny, defaultValue: unknown): void {
		// Ensure key is unique, but it's fine when the schemas match.
		if (this._Schemas.has(key) && this._Schemas.get(key) !== schema) throw new ConfigRegistrationError(key);
		const result = schema.safeParse(defaultValue);
		if (!result.success) {
			const isSecret = IsMarkedSecret(schema);
			const message = isSecret ? 'Default value does not match the provided schema (value redacted for security).' : 'Default value does not match the provided schema.';
			const options = isSecret ? undefined : { cause: result.error };
			throw new ConfigValidationError(key, message, options);
		}
		const parsed = result.data;

		// Deep-clone mutable types to prevent caller mutation
		const clonedDefault = Array.isArray(parsed)
			? [...parsed]
			: parsed instanceof Date
				? new Date(parsed.getTime())
				: parsed;

		this._Schemas.set(key, schema);
		// Safe: clonedDefault is the parsed result of schema.safeParse(), which succeeded
		this._DataDefaults.set(key, clonedDefault as TConfigValueTypes);
		this._dataCache = null;
		this._parsedCache.delete(key);

		// Cache schema metadata for use in Save()
		this._schemaMetaCache.set(key, {
			isSecret: IsMarkedSecret(schema),
			description: GetFieldDescription(schema)
		});

		// Apply any provider value already loaded for this key
		if (this._providerRawData.has(key)) {
			const rawProviderValue = this._providerRawData.get(key);
			const providerResult = schema.safeParse(rawProviderValue);
			if (providerResult.success) {
				// Safe: safeParse succeeds only if providerResult.data matches schema's type
				this._providerValues.set(key, providerResult.data as TConfigValueTypes);
				this._dataCache = null;
			}
		}
	}

	/**
	 * Set a configuration value and validate against its schema.
	 * @param key - Configuration key
	 * @param value - Value to set and validate
	 * @param target - Whether to set the default store or the override store; defaults to `'OVERRIDE'`
	 * @throws {ConfigNotRegisteredError} If schema is not registered for key
	 * @throws {ConfigValidationError} If validation fails
	 */
	public Set<T extends TConfigValueTypes>(key: string, value: T, target: TConfigSource = 'OVERRIDE'): void {
		const schema = this._Schemas.get(key);
		if (!schema) throw new ConfigNotRegisteredError(key);
		try {
			const parsed = schema.parse(value) as TConfigValueTypes;
			// Safe: Register validates that this schema produces TConfigValueTypes at runtime
			if (target === 'DEFAULT') {
				this._DataDefaults.set(key, parsed);
			}
			else {
				this._DataOverrides.set(key, parsed);
			}
			this._dataCache = null;
			this._parsedCache.delete(key);
		}
		catch (cause) {
			const isSecret = this._schemaMetaCache.get(key)?.isSecret ?? false;
			const message = isSecret ? 'value failed validation (value redacted for security)' : GetErrorMessage(cause);
			const options = isSecret ? undefined : (cause instanceof Error ? cause : undefined);
			throw new ConfigValidationError(key, message, options ? { cause: options } : undefined);
		}
	}

	/**
	 * Retrieve a configuration value by key.
	 * @param key - Configuration key
	 * @param source - Optional — filter to a specific store (`'DEFAULT'` or `'OVERRIDE'`); omit to return the resolved value
	 * @returns The typed configuration value
	 * @throws {ConfigNotSetError} If value was not set
	 * @throws {ConfigNotRegisteredError} If schema is not registered
	 * @throws {ConfigValidationError} If validation fails
	 */
	public Get(key: string, source?: TConfigSource): TConfigValueTypes {
		const dataSource = source === 'DEFAULT' ? this._DataDefaults : source === 'OVERRIDE' ? this._DataOverrides : this._Data;
		if (!dataSource.has(key)) throw new ConfigNotSetError(key);
		// Safe: has() guard above guarantees presence; stored values match schema types
		const value = dataSource.get(key) as TConfigValueTypes;

		// Only use parsed cache for resolved (non-source-filtered) values
		if (source === undefined && this._parsedCache.has(key)) {
			// has() guard above guarantees presence — use type assertion instead of ! (ESLint: no-non-null-assertion)
			return this._parsedCache.get(key) as TConfigValueTypes;
		}

		const schema = this.GetSchema(key);
		try {
			const rvalue = schema.parse(value) as TConfigValueTypes;
			// Safe: Register validates that this schema produces TConfigValueTypes at runtime

			// Cache the parsed result (only for resolved values, not source-filtered)
			if (source === undefined) {
				this._parsedCache.set(key, rvalue);
			}

			return rvalue;
		}
		catch (cause) {
			throw new ConfigValidationError(key, GetErrorMessage(cause), cause instanceof Error ? { cause } : undefined);
		}
	}

	/**
	 * Retrieve the schema for a configuration key.
	 * @param key - Configuration key
	 * @returns The Zod schema for this configuration
	 * @throws {ConfigNotRegisteredError} If schema is not registered for key
	 */
	public GetSchema(key: string): z.ZodTypeAny {
		const schema = this._Schemas.get(key);
		if (!schema) throw new ConfigNotRegisteredError(key);
		return schema;
	}
}
