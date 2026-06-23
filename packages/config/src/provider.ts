import { z } from 'zod/v4';

export const CONFIG_PROVIDER_OPTIONS_SCHEMA = z.object({
	name: z.string().min(1)
});
export type TConfigProviderOptions = z.infer<typeof CONFIG_PROVIDER_OPTIONS_SCHEMA>;
export function AssertConfigProviderOptions(options: unknown): asserts options is TConfigProviderOptions {
	CONFIG_PROVIDER_OPTIONS_SCHEMA.parse(options);
}
export function ValidateConfigProviderOptions(options: unknown): boolean {
	try {
		AssertConfigProviderOptions(options);
		return true;
	}
	catch {
		return false;
	}
}

export const CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA = z.object({
	useCurrentValues: z.boolean().optional()
});
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
	 * Synchronously load all configuration values from this provider's data source.
	 *
	 * Called once by {@link ConfigManager.RegisterProvider}. The returned record maps
	 * fully-qualified configuration key names to their raw values. Keys that are not
	 * registered with {@link ConfigManager} or whose values fail schema validation are
	 * silently skipped by the manager.
	 *
	 * @returns - A record of fully-qualified key names to raw (unvalidated) values
	 */
	public abstract Load(options?: TLoadOptions): Promise<Record<string, unknown>>;

	public abstract Save(entries: readonly ConfigSaveEntry[], options?: TSaveOptions): Promise<void>;
}

/**
 * A single configuration entry passed to {@link ISaveableConfigProvider.save}.
 *
 * ConfigManager builds one entry per registered key and passes the full list to
 * the provider, which is responsible for formatting and writing the output.
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
 * Synchronous configuration provider interface.
 *
 * Implement this to supply raw key/value pairs to {@link ConfigManager}.
 */
export interface IConfigProvider {
	readonly name: string;
	Load(): Promise<Record<string, unknown>>;
	Save(entries: readonly ConfigSaveEntry[], options?: SaveOptions): Promise<void>;
}

/**
 * Options for saving configuration via {@link ConfigManager.Save}.
 */
export interface SaveOptions {
	path: string;
	useCurrentValues?: boolean;
}

/**
 * Type alias for a single configuration save entry.
 * @see {@link IConfigSaveEntry}
 */
export type ConfigSaveEntry = IConfigSaveEntry;

/**
 * Configuration provider capable of both loading and saving configuration.
 */
export interface ISaveableConfigProvider extends IConfigProvider {
	/**
	 * Save configuration entries to the provider's destination.
	 * Implementations should honor the {@link SaveOptions} for path and value selection.
	 *
	 * @param entries - Configuration entries to save
	 * @param options - Save options including output path and whether to use current values
	 */
	Save(entries: readonly ConfigSaveEntry[], options?: SaveOptions): Promise<void>;
}

/**
 * Synchronous configuration provider for read-only sources.
 * Provides a synchronous escape hatch for contexts that cannot `await`.
 *
 * @remarks
 * This interface supports synchronous loading only. For saving, use {@link ISaveableConfigProvider}
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
	readonly name: string;
	/**
	 * Synchronously load all configuration values from this provider's data source.
	 * Use this only in contexts that cannot `await`. Otherwise prefer {@link IConfigProvider.Load}.
	 *
	 * @returns - A record of fully-qualified key names to raw (unvalidated) values
	 */
	LoadSync(): Record<string, unknown>;
}
