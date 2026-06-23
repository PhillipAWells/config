import { type z } from 'zod/v4';
import { ConfigManager, type TConfigSource, type TConfigValueTypes } from './manager.js';
import { IsMarkedSecret } from './secret.js';
import { ConfigNotRegisteredError, ConfigNotSetError } from './errors.js';

/**
 * Configuration schema object with static-like methods for managing config values.
 * Provides Get, Set, Validate, IsSecret, GetSecretKeys, and Redact methods
 * for a specific config namespace. The schema is auto-registered with ConfigManager at
 * call time; no explicit Register() call is needed.
 *
 * @template TConfig - The inferred type of the Zod schema
 * @template TKeys - Union of config keys from the schema shape
 */
export interface IConfigSchemaObject<
	TConfig extends Record<string, unknown>,
	TKeys extends keyof TConfig = keyof TConfig
> {
	/**
	 * Human-readable namespace name used to derive the environment variable prefix.
	 * For example, 'Keycloak' derives the prefix 'KEYCLOAK_'.
	 */
	readonly name: string;

	/**
	 * Get a typed config value by key.
	 *
	 * @param key - Configuration key to retrieve
	 * @returns The typed config value
	 * @template K - Specific config key type
	 *
	 * @example
	 * const host = MongoDBConfig.Get('HOST');
	 * // host is typed as string
	 */
	Get<K extends TKeys>(key: K): TConfig[K];

	/**
	 * Set a config value with optional source.
	 *
	 * @param key - Configuration key to set
	 * @param value - Typed value matching the key
	 * @param source - Override source ('DEFAULT' or 'OVERRIDE'), defaults to 'OVERRIDE'
	 * @template K - Specific config key type
	 * @throws Error if the value fails validation
	 *
	 * @example
	 * MongoDBConfig.Set('HOST', 'localhost:27017', 'OVERRIDE');
	 */
	Set<K extends TKeys>(key: K, value: TConfig[K], source?: TConfigSource): void;

	/**
	 * Validate a value against its schema without setting it.
	 *
	 * @param key - Configuration key whose schema is used for validation
	 * @param value - Unknown value to validate
	 * @returns true if the value is valid for this key, false otherwise
	 * @template K - Specific config key type
	 *
	 * @remarks Unlike `ParseENV()`, this method does not apply `ParseEnvVarValue` pre-processing. It expects a pre-typed value, not a raw environment variable string. For example, pass the number `3000`, not the string `"3000"`, when validating against a `z.number()` schema.
	 *
	 * @example
	 * if (MongoDBConfig.Validate('PORT', '27017')) {
	 *   // value is valid for PORT
	 * }
	 */
	Validate<K extends TKeys>(key: K, value: unknown): boolean;

	/**
	 * Returns whether the given key was marked as a secret field using Secret().
	 *
	 * @param key - The configuration key to check
	 * @returns true if the key was marked with Secret() at schema construction time
	 */
	IsSecret(key: TKeys): boolean;

	/**
	 * Returns an array of all keys that were marked as secret using Secret(),
	 * in schema shape insertion order.
	 *
	 * @returns Array of secret key names
	 */
	GetSecretKeys(): Array<TKeys>;

	/**
	 * Returns a snapshot of all currently resolved config values where secret
	 * fields are replaced with '***'. Keys that have not been registered yet
	 * are omitted from the result.
	 *
	 * @returns Record of config values with secrets redacted
	 */
	Redact(): Record<string, unknown>;
}

/**
 * Safely extracts the default value from a Zod schema, handling both
 * lazy defaults (functions) and eager defaults (plain values).
 * Traverses wrapper schemas (ZodDefault, ZodOptional, ZodNullable, etc.)
 * to find the default value.
 *
 * @param schema - The field schema to extract the default from
 * @returns The evaluated default value, or undefined if not present
 * @remarks Returns `undefined` in two distinct cases: (1) the schema has no `ZodDefault` wrapper, and (2) the `ZodDefault` wrapper explicitly wraps `undefined` as its default value. Callers cannot distinguish these cases from the return value alone.
 */
function ExtractDefaultValue(schema: z.ZodTypeAny): unknown {
	let current: z.ZodTypeAny = schema;
	while (current != null) {
		const def = (current as { def?: { defaultValue?: unknown } }).def;
		if (def != null && 'defaultValue' in def) {
			return def.defaultValue;
		}
		const inner = (current as { unwrap?: () => z.ZodTypeAny }).unwrap;
		if (typeof inner === 'function') {
			current = inner.call(current) as z.ZodTypeAny;
		}
		else {
			break;
		}
	}
	return undefined;
}

/**
 * Registers a configuration schema with {@link ConfigManager} and returns a typed
 * accessor object for the namespace.
 *
 * All schema fields are registered with {@link ConfigManager} immediately when this
 * function is called. The name is used to derive the environment variable prefix:
 * `name.toUpperCase() + '_'` (e.g. `'Keycloak'` → `KEYCLOAK_`).
 *
 * **Important:** Call {@link ConfigManager.RegisterProvider} for all providers before
 * importing any module that calls `RegisterConfigSchema` so that provider values are
 * available when schemas are registered.
 *
 * @param name - Human-readable namespace name; used to derive the env var prefix
 * @param schema - Zod object schema defining the config shape and validation rules
 * @returns {@link IConfigSchemaObject} with typed accessor methods
 * @throws {ConfigurationError} If any field's default value does not satisfy its schema
 *
 * @example
 * ```typescript
 * const KEYCLOAK_SCHEMA = z.object({
 *   AUTH_SERVER_URL: z.string().url().default('http://localhost:8080/auth'),
 *   REALM: z.string().min(1).default('master'),
 * });
 *
 * export const KeycloakConfig = RegisterConfigSchema('Keycloak', KEYCLOAK_SCHEMA);
 * // → prefix is 'KEYCLOAK_'; fields registered immediately
 * // → KeycloakConfig.Get('AUTH_SERVER_URL') returns the resolved value
 * ```
 */
export function RegisterConfigSchema<TSchema extends z.ZodRawShape>(name: string, schema: z.ZodObject<TSchema>): IConfigSchemaObject<z.infer<typeof schema>> {
	type TConfig = z.infer<typeof schema>;
	type TKeys = keyof TConfig;

	const prefix = `${name.toUpperCase()}_`;
	ConfigManager.RegisterNamespace(name, prefix);

	// Build a map of key -> prefixed name, a set of secret keys, and register all fields in a single pass
	const prefixedNames: Record<string, string> = {};
	const secretKeys = new Set<string>();

	for (const key of Object.keys(schema.shape) as (keyof TSchema & string)[]) {
		const prefixedKey = prefix ? `${prefix}${key}` : key;
		prefixedNames[key] = prefixedKey;
		const fieldSchema = schema.shape[key as keyof TSchema] as unknown as z.ZodTypeAny;
		if (IsMarkedSecret(fieldSchema)) {
			secretKeys.add(key);
		}
		// Register schema field with its default value
		const defaultValue = ExtractDefaultValue(fieldSchema);
		// Type: Register accepts ZodTypeAny; runtime enforcement via AssertConfigValueType
		ConfigManager.Register(prefixedKey, fieldSchema, defaultValue);
	}

	return {
		name,

		Get<K extends TKeys>(key: K): TConfig[K] {
			return ConfigManager.Get(prefixedNames[key as string]) as TConfig[K];
		},

		Set<K extends TKeys>(key: K, value: TConfig[K], source: TConfigSource = 'OVERRIDE'): void {
			// Type: TConfig[K] maps to TConfigValueTypes at runtime via Zod schema validation.
			// The schema was validated at registration (line 190), so this cast is safe.
			ConfigManager.Set(prefixedNames[key as string], value as TConfigValueTypes, source);
		},

		Validate<K extends TKeys>(key: K, value: unknown): boolean {
			const fieldSchema = schema.shape[key as keyof TSchema] as unknown as z.ZodType;
			try {
				fieldSchema.parse(value);
				return true;
			}
			catch {
				return false;
			}
		},

		IsSecret(key: TKeys): boolean {
			return secretKeys.has(key as string);
		},

		GetSecretKeys(): Array<TKeys> {
			return Array.from(secretKeys) as Array<TKeys>;
		},

		Redact(): Record<string, unknown> {
			const result: Record<string, unknown> = {};
			for (const key of Object.keys(schema.shape)) {
				try {
					const value = this.Get(key as TKeys);
					result[key] = secretKeys.has(key) ? '***' : value;
				}
				catch (error) {
					if (
						error instanceof ConfigNotSetError
						|| error instanceof ConfigNotRegisteredError
					) {
						// omit unregistered/unset keys
						continue;
					}
					throw error;
				}
			}
			return result;
		}
	};
}
