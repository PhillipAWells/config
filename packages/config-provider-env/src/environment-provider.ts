import { promises as FS } from 'node:fs';
import * as PATH from 'node:path';
import { z } from 'zod/v4';
import { ConfigProvider, CONFIG_PROVIDER_OPTIONS_SCHEMA, CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA, type ConfigSaveEntry, ConfigManager, ConfigError } from '@pawells/config';
import { ParseEnvVarValue, ParseDotEnvFileAsync, SerializeConfigValue } from './env-utils.js';

/**
 * Zod schema for validating ConfigEnvironmentProvider constructor options.
 *
 * @remarks
 * This schema extends the base {@link CONFIG_PROVIDER_OPTIONS_SCHEMA} with environment-specific fields:
 * - `name`: Unique provider identifier (default: `'environment'`)
 * - `path`: Path to the `.env` file to load (default: `.env` in current working directory);
 *   paths containing `..` directory traversal sequences are rejected for security
 */
export const CONFIG_ENV_PROVIDER_OPTIONS_SCHEMA = CONFIG_PROVIDER_OPTIONS_SCHEMA.extend({
	name: z.string().min(1).default('environment'),
	path: z.string().min(1).default(PATH.join(process.cwd(), '.env')).refine((path: string) => !PATH.normalize(path).includes('..'), {
		message: 'Path traversal sequences ("..") are not permitted.'
	})
});

/**
 * Runtime type extracted from {@link CONFIG_ENV_PROVIDER_OPTIONS_SCHEMA}.
 *
 * @example
 * ```typescript
 * const options: TConfigENVProviderOptions = {
 *   name: 'my-env',
 *   path: '.env.local'
 * };
 * ```
 */
export type TConfigENVProviderOptions = z.infer<typeof CONFIG_ENV_PROVIDER_OPTIONS_SCHEMA>;

/**
 * Asserts that a value conforms to {@link TConfigENVProviderOptions}.
 *
 * @param options - The value to validate
 * @throws {ZodError} When validation fails
 *
 * @example
 * ```typescript
 * AssertConfigENVProviderOptions(userInput);
 * // If no error, userInput is safely typed as TConfigENVProviderOptions
 * ```
 */
export function AssertConfigENVProviderOptions(options: unknown): asserts options is TConfigENVProviderOptions {
	CONFIG_ENV_PROVIDER_OPTIONS_SCHEMA.parse(options);
}

/**
 * Validates whether a value conforms to {@link TConfigENVProviderOptions}.
 *
 * @param options - The value to validate
 * @returns `true` if valid; `false` otherwise
 *
 * @example
 * ```typescript
 * if (ValidateConfigENVProviderOptions(userInput)) {
 *   // userInput is valid
 * }
 * ```
 */
export function ValidateConfigENVProviderOptions(options: unknown): boolean {
	try {
		AssertConfigENVProviderOptions(options);
		return true;
	}
	catch {
		return false;
	}
}

/**
 * Zod schema for validating ConfigEnvironmentProvider Save options.
 *
 * @remarks
 * Extends the base {@link CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA} with:
 * - `path`: Optional output file path; overrides constructor path if provided
 */
export const CONFIG_ENV_PROVIDER_SAVE_OPTIONS_SCHEMA = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.extend({
	path: z.string().min(1).refine((path: string) => !PATH.normalize(path).includes('..'), {
		message: 'Path traversal sequences ("..") are not permitted.'
	}).optional()
});

/**
 * Runtime type extracted from {@link CONFIG_ENV_PROVIDER_SAVE_OPTIONS_SCHEMA}.
 *
 * @example
 * ```typescript
 * const options: TConfigENVProviderSaveOptions = {
 *   path: '.env.example',
 *   useCurrentValues: false
 * };
 * ```
 */
export type TConfigENVProviderSaveOptions = z.infer<typeof CONFIG_ENV_PROVIDER_SAVE_OPTIONS_SCHEMA>;

/**
 * Asserts that a value conforms to {@link TConfigENVProviderSaveOptions}.
 *
 * @param options - The value to validate
 * @throws {ZodError} When validation fails
 */
export function AssertConfigENVProviderSaveOptions(options: unknown): asserts options is TConfigENVProviderSaveOptions {
	CONFIG_ENV_PROVIDER_SAVE_OPTIONS_SCHEMA.parse(options);
}

/**
 * Validates whether a value conforms to {@link TConfigENVProviderSaveOptions}.
 *
 * @param options - The value to validate
 * @returns `true` if valid; `false` otherwise
 */
export function ValidateConfigENVProviderSaveOptions(options: unknown): boolean {
	try {
		AssertConfigENVProviderSaveOptions(options);
		return true;
	}
	catch {
		return false;
	}
}

/**
 * Configuration provider for environment variables and `.env` files.
 *
 * Loads configuration from `process.env` and an optional `.env` file. This provider
 * implements the {@link ConfigProvider} interface, supporting both {@link Load} and
 * {@link Save} operations. It is suitable for development environments and containerized
 * deployments where configuration is typically provided via environment variables.
 *
 * @example
 * ```typescript
 * // Register with defaults
 * const provider = await ConfigEnvironmentProvider.Register();
 *
 * // Register with custom path
 * const provider = await ConfigEnvironmentProvider.Register({
 *   path: '.env.production'
 * });
 *
 * // Or instantiate directly
 * const provider = new ConfigEnvironmentProvider({
 *   name: 'app-env',
 *   path: '.env'
 * });
 * await ConfigManager.RegisterProvider(provider);
 * ```
 */
export class ConfigEnvironmentProvider extends ConfigProvider<TConfigENVProviderOptions, unknown, TConfigENVProviderSaveOptions> {
	/**
	 * Initialize a configuration provider that loads from environment variables and a `.env` file.
	 *
	 * @param options - Provider configuration object with `name` and optional `path`
	 * @param options.name - Unique provider name (default: `'environment'`)
	 * @param options.path - Path to the `.env` file to load (default: `.env` in current working directory)
	 *
	 * @example
	 * ```typescript
	 * const provider = new ConfigEnvironmentProvider({
	 *   name: 'my-env-provider',
	 *   path: './.env.local'
	 * });
	 * ```
	 */
	constructor(options: TConfigENVProviderOptions) {
		super(options);
		AssertConfigENVProviderOptions(options);
	}

	/**
	 * Load configuration values from `process.env` and, optionally, a `.env` file.
	 *
	 * Reads all entries in `process.env` first, then (if `options.path` is set)
	 * reads the dotenv file and overwrites any overlapping keys. All values are passed
	 * through {@link ParseEnvVarValue} before being returned.
	 *
	 * If the dotenv file is missing or cannot be read due to permission errors or other
	 * file system issues, the file is silently skipped and only environment variables are
	 * returned. The dotenv file is optional and its absence or read failure does not prevent
	 * configuration loading.
	 *
	 * Security rejections (symlink detection, path traversal) are propagated as errors.
	 *
	 * @returns A record of fully-qualified config key names to their parsed values
	 * @throws {ConfigError} When the dotenv path is a symlink or contains path traversal sequences
	 *
	 * @example
	 * ```typescript
	 * // process.env = { KEYCLOAK_HOST: 'prod.example.com' }
	 * // .env        = { KEYCLOAK_HOST: 'localhost', KEYCLOAK_PORT: '8080' }
	 * const provider = new ConfigEnvironmentProvider({
	 *   name: 'env',
	 *   path: '.env'
	 * });
	 * const config = await provider.Load();
	 * // → { KEYCLOAK_HOST: 'localhost', KEYCLOAK_PORT: 8080 }
	 * ```
	 */
	public async Load(): Promise<Record<string, unknown>> {
		const result: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined) {
				result[key] = ParseEnvVarValue(value);
			}
		}

		if (this.options.path !== undefined) {
			try {
				const dotenv = await ParseDotEnvFileAsync(this.options.path);
				for (const [key, value] of Object.entries(dotenv)) {
					result[key] = ParseEnvVarValue(value);
				}
			}
			catch (error: unknown) {
				// Re-throw ConfigError (security rejections: symlink, path traversal)
				if (error instanceof ConfigError) {
					throw error;
				}
				// Silently skip other file errors (ENOENT, EACCES, etc.);
				// dotenv is optional and fallback uses process.env values already collected
			}
		}

		return result;
	}

	/**
	 * Save configuration values to a `.env`-format file.
	 *
	 * In template mode (`useCurrentValues: false`, the default), each entry is
	 * written using its registered default value. Secret fields (where
	 * `entry.isSecret` is `true`) are always written with a blank value in
	 * template mode, regardless of their default — making this suitable for
	 * generating `.env.example` files.
	 *
	 * In current-values mode (`useCurrentValues: true`), the live resolved value
	 * is used for every field including secrets — suitable for snapshotting the
	 * active runtime configuration.
	 *
	 * If a field carries a description (from a Zod `.describe()` annotation) it
	 * is emitted as a `# comment` line immediately before the key–value pair.
	 *
	 * @param entries - All registered config entries supplied by {@link ConfigManager.Save}
	 * @param options - Save options
	 * @param options.path - Output file path; overrides `this.options.path` if provided
	 * @param options.useCurrentValues - When `true`, emit current live values; when `false` (default), emit registered defaults
	 *
	 * @example
	 * ```typescript
	 * const provider = new ConfigEnvironmentProvider({
	 *   name: 'env',
	 *   path: '.env'
	 * });
	 *
	 * // Generate a .env.example template (secrets blank)
	 * await ConfigManager.Save(provider, { path: '.env.example' });
	 *
	 * // Snapshot current runtime config (secrets included)
	 * await ConfigManager.Save(provider, {
	 *   path: '.env.snapshot',
	 *   useCurrentValues: true,
	 * });
	 * ```
	 */
	public async Save(entries: readonly ConfigSaveEntry[], options?: TConfigENVProviderSaveOptions): Promise<void> {
		if (options !== undefined) AssertConfigENVProviderSaveOptions(options);
		const useCurrentValues = options?.useCurrentValues ?? false;
		const path = options?.path ?? this.options.path;
		const lines: string[] = [];

		for (const entry of entries) {
			if (entry.description !== undefined) {
				const safeDescription = entry.description.replace(/[\r\n]/g, ' ').replace(/#/g, '(hash)');
				lines.push(`# ${safeDescription}`);
			}

			if (!useCurrentValues && entry.isSecret) {
				lines.push(`${entry.key}=`);
			}
			else {
				lines.push(`${entry.key}=${SerializeConfigValue(entry.value)}`);
			}
		}

		await FS.writeFile(path, lines.join('\n'), 'utf-8');
	}

	/**
	 * Creates a ConfigEnvironmentProvider instance and registers it with ConfigManager.
	 *
	 * This is a convenience factory method that combines instantiation and registration in one call.
	 * Unspecified options use their schema defaults (`name: 'environment'`, `path: '.env'` in cwd).
	 *
	 * @param options - Optional partial provider configuration; unspecified fields use schema defaults
	 * @returns A promise resolving to the registered provider instance
	 *
	 * @example
	 * ```typescript
	 * // Register with all defaults
	 * const provider = await ConfigEnvironmentProvider.Register();
	 *
	 * // Register with custom path
	 * const provider = await ConfigEnvironmentProvider.Register({
	 *   path: '.env.production'
	 * });
	 * ```
	 */
	public static async Register(options: Partial<TConfigENVProviderOptions> = {}): Promise<ConfigEnvironmentProvider> {
		const provider = new ConfigEnvironmentProvider(CONFIG_ENV_PROVIDER_OPTIONS_SCHEMA.parse(options));
		await ConfigManager.RegisterProvider(provider);
		return provider;
	}
}
