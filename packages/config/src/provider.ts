/**
 * Configuration provider abstractions and validation schemas.
 *
 * Providers are data sources that supply raw key/value pairs to {@link ConfigManager}.
 * They occupy the middle precedence tier — their values override registered defaults
 * but are themselves overridden by explicit {@link ConfigManager.Set} calls.
 *
 * @module provider
 */

import { z } from 'zod/v4';

/**
 * Zod schema validating configuration provider options.
 *
 * @remarks
 * All providers must have at minimum a `name` string field for diagnostics.
 *
 * @example
 * ```typescript
 * const options = { name: 'my-provider' };
 * CONFIG_PROVIDER_OPTIONS_SCHEMA.parse(options);
 * ```
 */
export const CONFIG_PROVIDER_OPTIONS_SCHEMA = z.object({
	name: z.string().min(1)
});

/**
 * Inferred type of {@link CONFIG_PROVIDER_OPTIONS_SCHEMA}.
 */
export type TConfigProviderOptions = z.infer<typeof CONFIG_PROVIDER_OPTIONS_SCHEMA>;

/**
 * Asserts that a value conforms to {@link TConfigProviderOptions}.
 *
 * @param options - The value to assert
 * @throws {ZodError} If options does not match the schema
 * @example
 * ```typescript
 * AssertConfigProviderOptions({ name: 'my-provider' });
 * ```
 */
export function AssertConfigProviderOptions(options: unknown): asserts options is TConfigProviderOptions {
	CONFIG_PROVIDER_OPTIONS_SCHEMA.parse(options);
}

/**
 * Validates whether a value conforms to {@link TConfigProviderOptions}.
 *
 * @param options - The value to validate
 * @returns `true` if options matches the schema, `false` otherwise
 * @example
 * ```typescript
 * if (ValidateConfigProviderOptions(obj)) {
 *   // obj is now typed as TConfigProviderOptions
 * }
 * ```
 */
export function ValidateConfigProviderOptions(options: unknown): boolean {
	try {
		AssertConfigProviderOptions(options);
		return true;
	}
	catch {
		return false;
	}
}

/**
 * Zod schema validating configuration provider save options.
 *
 * @remarks
 * Save options control how configuration is written to a provider's destination.
 *
 * @example
 * ```typescript
 * const saveOpts = { useCurrentValues: true };
 * CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.parse(saveOpts);
 * ```
 */
export const CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA = z.object({
	useCurrentValues: z.boolean().optional()
});

/**
 * Inferred type of {@link CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA}.
 */
export type TConfigProviderSaveOptions = z.infer<typeof CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA>;

/**
 * Contract for configuration value providers.
 *
 * A provider is a synchronous data source that supplies raw key/value pairs to
 * {@link ConfigManager}. Providers occupy the middle precedence tier — their values
 * override registered defaults but are themselves overridden by explicit
 * {@link ConfigManager.Set} calls.
 *
 * @example
 * ```typescript
 * class MyProvider implements IConfigProvider {
 *   readonly name = 'my-provider';
 *   load(): Record<string, unknown> {
 *     return { MY_KEY: 'my-value' };
 *   }
 * }
 * ```
 */
export abstract class ConfigProvider<
	TOptions extends TConfigProviderOptions = TConfigProviderOptions,
	TLoadOptions = unknown,
	TSaveOptions extends TConfigProviderSaveOptions = TConfigProviderSaveOptions
> {
	/**
	 * Unique name identifying this provider instance.
	 * Used for diagnostics only.
	 */
	private readonly _Name: string;
	public get Name(): string {
		return this._Name;
	}

	constructor(protected readonly options: TOptions) {
		this._Name = options.name;
	}

	/**
	 * Asynchronously load all configuration values from this provider's data source.
	 *
	 * Called once by {@link ConfigManager.RegisterProvider}. The returned record maps
	 * fully-qualified configuration key names to their raw values. Keys that are not
	 * registered with {@link ConfigManager} or whose values fail schema validation are
	 * silently skipped by the manager.
	 *
	 * @param options - Optional load options specific to this provider
	 * @returns - A promise resolving to a record of fully-qualified key names to raw (unvalidated) values
	 * @example
	 * ```typescript
	 * const provider = new MyProvider();
	 * const data = await provider.Load({ timeout: 5000 });
	 * ```
	 */
	public abstract Load(options?: TLoadOptions): Promise<Record<string, unknown>>;

	public abstract Save(entries: readonly ConfigSaveEntry[], options?: TSaveOptions): Promise<void>;
}

/**
 * A single configuration entry passed to {@link IConfigProvider.Save}.
 *
 * ConfigManager builds one entry per registered key and passes the full list to
 * the provider, which is responsible for formatting and writing the output.
 *
 * @example
 * ```typescript
 * const entry: ConfigSaveEntry = {
 *   key: 'KEYCLOAK_HOST',
 *   section: 'KEYCLOAK',
 *   field: 'HOST',
 *   value: 'https://auth.example.com',
 *   isSecret: false,
 *   description: 'Keycloak server address'
 * };
 * ```
 */
export interface IConfigSaveEntry {
	/**
	 * Fully-qualified configuration key (e.g. `KEYCLOAK_HOST`).
	 */
	readonly key: string;

	/**
	 * Namespace section name, derived from the prefix registered via
	 * {@link ConfigManager.RegisterNamespace} (e.g. `KEYCLOAK`).
	 * Empty string for keys that were not registered under any namespace.
	 */
	readonly section: string;

	/**
	 * Field name within the section (e.g. `HOST`).
	 * Equal to {@link key} when {@link section} is empty.
	 */
	readonly field: string;

	/**
	 * Resolved value for this entry — either the current live value
	 * (`useCurrentValues: true`) or the registered default (`false`).
	 * May be `undefined` if the key has no value in the selected mode.
	 */
	readonly value: unknown;

	/**
	 * Whether this field was marked with {@link Secret}.
	 * Providers should redact or blank secrets in template mode.
	 */
	readonly isSecret: boolean;

	/**
	 * Optional human-readable description from a Zod `.describe()` annotation.
	 * Providers typically emit this as a comment line.
	 */
	readonly description: string | undefined;
}

/**
 * Options for saving configuration via {@link ConfigManager.Save} and {@link IConfigProvider.Save}.
 *
 * @example
 * ```typescript
 * const options: SaveOptions = {
 *   path: '.env.example',
 *   useCurrentValues: false
 * };
 * ```
 */
export interface SaveOptions {
	/**
	 * Path where the provider should write the configuration file.
	 */
	path: string;

	/**
	 * Whether to save current runtime values (`true`) or registered defaults (`false`).
	 * Default is `false`.
	 */
	useCurrentValues?: boolean;
}

/**
 * Type alias for a single configuration save entry.
 * @see {@link IConfigSaveEntry}
 */
export type ConfigSaveEntry = IConfigSaveEntry;

/**
 * Configuration provider interface for both loading and saving configuration.
 *
 * A provider is a data source that supplies raw key/value pairs to {@link ConfigManager}.
 * Providers occupy the middle precedence tier — their values override registered defaults
 * but are themselves overridden by explicit {@link ConfigManager.Set} calls.
 *
 * @example
 * ```typescript
 * class MyProvider implements IConfigProvider {
 *   readonly name = 'my-provider';
 *
 *   async Load(): Promise<Record<string, unknown>> {
 *     return { MY_KEY: 'my-value' };
 *   }
 *
 *   async Save(entries: readonly ConfigSaveEntry[], options?: SaveOptions): Promise<void> {
 *     // Write entries to file at options.path
 *   }
 * }
 * ```
 */
export interface IConfigProvider {
	/**
	 * Unique name identifying this provider instance.
	 * Used for diagnostics only.
	 */
	readonly Name: string;

	/**
	 * Asynchronously load all configuration values from this provider's data source.
	 *
	 * Called once by {@link ConfigManager.RegisterProvider}. The returned record maps
	 * fully-qualified configuration key names to their raw values. Keys that are not
	 * registered with {@link ConfigManager} or whose values fail schema validation are
	 * silently skipped by the manager.
	 *
	 * @returns - A promise resolving to a record of fully-qualified key names to raw (unvalidated) values
	 */
	Load(): Promise<Record<string, unknown>>;

	/**
	 * Save configuration entries to the provider's destination.
	 *
	 * Implementations should honor the {@link SaveOptions} for path and value selection.
	 * When entries contain fields marked as secret (`isSecret: true`), providers should
	 * typically redact or blank those values in template mode
	 * (`useCurrentValues: false`).
	 *
	 * @param entries - Configuration entries to save
	 * @param options - Save options including output path and whether to use current values
	 * @returns - A promise that resolves when the save operation completes
	 */
	Save(entries: readonly ConfigSaveEntry[], options?: SaveOptions): Promise<void>;
}

/**
 * Synchronous configuration provider for read-only sources.
 * Provides a synchronous escape hatch for contexts that cannot `await`.
 *
 * @remarks
 * This interface supports synchronous loading only. For saving, use {@link IConfigProvider}
 * or register the async provider and use `await ConfigManager.RegisterProvider()`.
 * Most use cases should prefer the async {@link IConfigProvider}.
 *
 * @example
 * ```typescript
 * class SyncMemoryProvider implements ISyncConfigProvider {
 *   readonly name = 'sync-memory';
 *   LoadSync() {
 *     return { MY_KEY: 'value' };
 *   }
 * }
 * ConfigManager.RegisterSyncProvider(new SyncMemoryProvider());
 * ```
 */
export interface ISyncConfigProvider {
	readonly Name: string;
	/**
	 * Synchronously load all configuration values from this provider's data source.
	 * Use this only in contexts that cannot `await`. Otherwise prefer {@link IConfigProvider.Load}.
	 *
	 * @returns - A record of fully-qualified key names to raw (unvalidated) values
	 */
	LoadSync(): Record<string, unknown>;
}
