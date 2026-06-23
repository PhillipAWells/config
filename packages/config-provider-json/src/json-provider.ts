import * as FS from 'node:fs/promises';
import * as PATH from 'node:path';
import { z } from 'zod/v4';
import { CONFIG_PROVIDER_OPTIONS_SCHEMA, CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA, ConfigError, ConfigManager, ConfigProvider, type ConfigSaveEntry } from '@pawells/config';
import { GetErrorMessage } from '@pawells/typescript-common';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const CONFIG_JSON_PROVIDER_PATH_SCHEMA = z.string().min(1)
	.default(PATH.join(process.cwd(), 'config.json'))
	.refine((path: string) => !PATH.normalize(path).includes('..'), {
		message: 'Path traversal sequences ("..") are not permitted.'
	});

export const CONFIG_JSON_PROVIDER_OPTIONS_SCHEMA = CONFIG_PROVIDER_OPTIONS_SCHEMA.extend({
	path: CONFIG_JSON_PROVIDER_PATH_SCHEMA,
	required: z.boolean().optional().default(false)
});
export type TConfigJSONProviderOptions = z.infer<typeof CONFIG_JSON_PROVIDER_OPTIONS_SCHEMA>;
export function AssertConfigJSONProviderOptions(options: unknown): asserts options is TConfigJSONProviderOptions {
	CONFIG_JSON_PROVIDER_OPTIONS_SCHEMA.parse(options);
}
export function ValidateConfigJSONProviderOptions(options: unknown): boolean {
	try {
		CONFIG_JSON_PROVIDER_OPTIONS_SCHEMA.parse(options);
		return true;
	}
	catch {
		return false;
	}
}

export const CONFIG_JSON_PROVIDER_SAVE_OPTIONS_SCHEMA = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.extend({
	path: CONFIG_JSON_PROVIDER_PATH_SCHEMA.optional()
});
export type TConfigJSONProviderSaveOptions = z.infer<typeof CONFIG_JSON_PROVIDER_SAVE_OPTIONS_SCHEMA>;
export function AssertConfigJSONProviderSaveOptions(options: unknown): asserts options is TConfigJSONProviderSaveOptions {
	CONFIG_JSON_PROVIDER_SAVE_OPTIONS_SCHEMA.parse(options);
}
export function ValidateConfigJSONProviderSaveOptions(options: unknown): boolean {
	try {
		CONFIG_JSON_PROVIDER_SAVE_OPTIONS_SCHEMA.parse(options);
		return true;
	}
	catch {
		return false;
	}
}

export const CONFIG_JSON_PROVIDER_LOAD_OPTIONS_SCHEMA = z.object({
	path: CONFIG_JSON_PROVIDER_PATH_SCHEMA.optional()
});
export type TConfigJSONProviderLoadOptions = z.infer<typeof CONFIG_JSON_PROVIDER_LOAD_OPTIONS_SCHEMA>;
export function AssertConfigJSONProviderLoadOptions(options: unknown): asserts options is TConfigJSONProviderLoadOptions {
	CONFIG_JSON_PROVIDER_LOAD_OPTIONS_SCHEMA.parse(options);
}
export function ValidateConfigJSONProviderLoadOptions(options: unknown): boolean {
	try {
		CONFIG_JSON_PROVIDER_LOAD_OPTIONS_SCHEMA.parse(options);
		return true;
	}
	catch {
		return false;
	}
}

/**
 * Configuration provider that reads values from a JSON file.
 *
 * The file must contain a JSON object at the top level. Nested objects are
 * flattened using the pattern `SECTION_FIELD` so that a config registered
 * as `KEYCLOAK_HOST` is found under `{ "KEYCLOAK": { "HOST": "..." } }`.
 * Top-level non-object values are kept under their own key unchanged.
 * Only one level of nesting is flattened; deeper nesting is skipped.
 *
 * Native JSON types (numbers, booleans, arrays, `null`) are passed directly
 * to Zod schema validation without any string pre-processing.
 *
 * @example
 * ```typescript
 * // config.json: { "KEYCLOAK": { "HOST": "localhost", "PORT": 8080 } }
 * const provider = new ConfigJSONProvider({
 *   name: 'json',
 *   path: './config.json',
 *   required: true
 * });
 * await ConfigManager.RegisterProvider(provider);
 * // Registers: KEYCLOAK_HOST='localhost', KEYCLOAK_PORT=8080
 *
 * // Optional file — no throw if missing
 * const optProvider = new ConfigJSONProvider({
 *   name: 'json-local',
 *   path: './config.local.json',
 *   required: false
 * });
 * await ConfigManager.RegisterProvider(optProvider);
 * ```
 */
export class ConfigJSONProvider extends ConfigProvider<
	TConfigJSONProviderOptions,
	TConfigJSONProviderLoadOptions,
	TConfigJSONProviderSaveOptions
> {
	/**
	 * Construct a JSON configuration provider.
	 *
	 * @param options - Provider configuration options
	 * @param options.name - Unique name identifying this provider instance (used for diagnostics)
	 * @param options.path - Path to the JSON configuration file; defaults to `./config.json`
	 * @param options.required - When `true` (default `false`), a missing or unreadable file throws an error; when `false`, returns `{}`
	 * @throws {ConfigError} If options fail schema validation or path contains path traversal sequences (..)
	 */
	constructor(options: TConfigJSONProviderOptions) {
		AssertConfigJSONProviderOptions(options);
		super(options);
	}

	/**
	 * Load and flatten the JSON configuration file asynchronously.
	 *
	 * Reads the file at `options.path` asynchronously, parses it as JSON, and flattens
	 * nested objects (one level deep) into fully-qualified keys using `_` as the separator.
	 * If the file cannot be read and `options.required` is `false`, returns `{}`.
	 *
	 * @param options - Optional load-time overrides (currently unused; reserved for future expansion)
	 * @returns - A flat record of fully-qualified config key names to their native-typed values
	 * @throws {ConfigError} If the file cannot be read and `options.required` is `true`
	 * @throws {ConfigError} When the config file exceeds 10MB
	 * @throws {ZodError} If the loaded JSON fails to parse or schema validation fails
	 *
	 * @example
	 * ```typescript
	 * // config.json:
	 * // { "APP": { "HOST": "localhost", "PORT": 3000, "DEBUG": false } }
	 * const provider = new ConfigJSONProvider({
	 *   name: 'json',
	 *   path: './config.json',
	 *   required: true
	 * });
	 * const values = await provider.Load();
	 * // → { APP_HOST: 'localhost', APP_PORT: 3000, APP_DEBUG: false }
	 * ```
	 */
	public async Load(): Promise<Record<string, unknown>> {
		try {
			const buffer = await FS.readFile(this.options.path);
			// Use byte-accurate size check: 10 MB = 10 * 1024 * 1024 bytes
			if (buffer.byteLength > 10 * 1024 * 1024) {
				throw new ConfigError('Config file exceeds 10MB limit');
			}

			const content = buffer.toString('utf-8');
			const parsed: unknown = JSON.parse(content);

			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

			const result: Record<string, unknown> = {};

			for (const [topKey, value] of Object.entries(parsed as Record<string, unknown>)) {
				if (DANGEROUS_KEYS.has(topKey)) continue;
				if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
					for (const [fieldKey, fieldValue] of Object.entries(value as Record<string, unknown>)) {
						if (DANGEROUS_KEYS.has(fieldKey)) continue;
						result[`${topKey}_${fieldKey}`] = fieldValue;
					}
				}
				else {
					result[topKey] = value;
				}
			}

			return result;
		}
		catch (error: unknown) {
			if (this.options.required) throw error;
			const isNotFound = error instanceof Error
			  && (error as NodeJS.ErrnoException).code === 'ENOENT';
			if (!isNotFound) {
				// Config provider soft failures (non-ENOENT read errors during optional-file load)
				// are a known exception to the logging-via-@pawells/logger policy.
				// The logger may not be available at config init time, so we use console.warn as a fallback.
				// eslint-disable-next-line no-console
				console.warn('[ConfigJSONProvider] Optional config file not found — using defaults.');
			}
			return {};
		}
	}

	/**
	 * Save configuration values to a nested JSON file asynchronously.
	 *
	 * Entries that belong to a registered namespace (i.e. `entry.section` is
	 * non-empty) are grouped under their section key, reproducing the nested
	 * structure that {@link Load} flattens on read:
	 * `KEYCLOAK_HOST` → `{ "KEYCLOAK": { "HOST": "..." } }`.
	 *
	 * Entries with no section (registered directly with {@link ConfigManager.Register}
	 * rather than via {@link ConfigManager.RegisterNamespace}) are written as top-level keys.
	 *
	 * In template mode (`useCurrentValues: false`, the default), secret fields
	 * (`entry.isSecret === true`) are written as `null`, clearly indicating that
	 * a value is required but intentionally absent — suitable for committed
	 * `config.example.json` template files.
	 *
	 * In current-values mode (`useCurrentValues: true`), all values including
	 * secrets are written as-is, capturing the current live state.
	 *
	 * The output file is pretty-printed with tab indentation.
	 *
	 * @param entries - All registered config entries supplied by {@link ConfigManager.Save}
	 * @param options - Save options including output file path and value-selection mode
	 * @param options.path - Output file path; defaults to `this.options.path` if not provided
	 * @param options.useCurrentValues - When `true`, write current live values; when `false` (default), write defaults and `null` for secrets
	 * @throws {ConfigError} If JSON serialization fails or file write fails
	 *
	 * @example
	 * ```typescript
	 * // Generate config.example.json (secrets as null, for committing)
	 * const provider = new ConfigJSONProvider({
	 *   name: 'json',
	 *   path: './config.json'
	 * });
	 * await provider.Save(entries, { path: './config.example.json' });
	 *
	 * // Snapshot current runtime config (with live secrets)
	 * await provider.Save(entries, {
	 *   path: './config.snapshot.json',
	 *   useCurrentValues: true
	 * });
	 * ```
	 */
	public async Save(entries: readonly ConfigSaveEntry[], options: TConfigJSONProviderSaveOptions): Promise<void> {
		AssertConfigJSONProviderSaveOptions(options);
		const path = options.path ?? this.options.path;
		const useCurrentValues = options.useCurrentValues ?? false;
		const result: Record<string, unknown> = {};

		for (const entry of entries) {
			const value = (!useCurrentValues && entry.isSecret) ? null : entry.value;

			if (DANGEROUS_KEYS.has(entry.section) || DANGEROUS_KEYS.has(entry.field)) {
				continue; // Skip prototype-pollution-risk keys
			}

			if (entry.section !== '') {
				if (typeof result[entry.section] !== 'object' || result[entry.section] === null) {
					result[entry.section] = {};
				}
				(result[entry.section] as Record<string, unknown>)[entry.field] = value;
			}
			else {
				result[entry.field] = value;
			}
		}

		let jsonOutput: string;
		try {
			jsonOutput = JSON.stringify(result, null, '\t');
		}
		catch (error: unknown) {
			throw new ConfigError(
				`Failed to serialize configuration to JSON: ${GetErrorMessage(error)}`,
				{ cause: error instanceof Error ? error : undefined }
			);
		}
		await FS.writeFile(path, jsonOutput, 'utf-8');
	}

	/**
	 * Create and register a ConfigJSONProvider with {@link ConfigManager}.
	 *
	 * A convenience factory that combines construction and registration.
	 * The provider is immediately registered with the global ConfigManager
	 * and returned for optional use.
	 *
	 * @param options - Partial provider options; missing fields use schema defaults
	 * @returns - The created and registered provider instance
	 * @throws {ZodError} If options fail schema validation
	 *
	 * @example
	 * ```typescript
	 * // Register with defaults (./config.json, required: false)
	 * ConfigJSONProvider.Register({ name: 'json' });
	 *
	 * // Register with custom path
	 * ConfigJSONProvider.Register({
	 *   name: 'json-local',
	 *   path: './config.local.json',
	 *   required: false
	 * });
	 * ```
	 */
	public static Register(options: Partial<TConfigJSONProviderOptions> = {}): ConfigJSONProvider {
		const provider = new ConfigJSONProvider(CONFIG_JSON_PROVIDER_OPTIONS_SCHEMA.parse(options));
		void ConfigManager.RegisterProvider(provider);
		return provider;
	}
}
