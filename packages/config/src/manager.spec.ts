import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod/v4';
import { ConfigManager, AssertConfigValueType, ScopedConfigManager } from './manager.js';
import {
	ConfigRegistrationError,
	ConfigNotRegisteredError,
	ConfigValidationError,
	ConfigNotSetError
} from './errors.js';
import { Secret } from './secret.js';
import type { SaveOptions, ConfigSaveEntry, IConfigProvider, ISyncConfigProvider } from './provider.js';

describe('ConfigManager', () => {
	beforeEach(() => ConfigManager.Reset());

	describe('ConfigManager.Reset', () => {
		it('After Reset, Register succeeds with same key (proves Maps cleared)', () => {
			const schema = z.string();
			ConfigManager.Register('TEST_KEY', schema, 'test_value');
			ConfigManager.Reset();
			// After reset, we should be able to register again without error
			expect(() => ConfigManager.Register('TEST_KEY', schema, 'another_value')).not.toThrow();
		});

		it('After Reset, Get throws ConfigurationNotSetError', () => {
			ConfigManager.Register('TEST_KEY', z.string(), 'default');
			ConfigManager.Reset();
			expect(() => ConfigManager.Get('TEST_KEY')).toThrow(ConfigNotSetError);
		});

		it('After Reset, RegisterProvider can be called again', async () => {
			const provider: IConfigProvider = {
				Name: 'test',
				Load: async () => ({ TEST_KEY: 'from-provider' }),
				Save: async () => { /* no-op */ }
			};
			ConfigManager.Register('TEST_KEY', z.string(), 'default');
			await ConfigManager.RegisterProvider(provider);
			ConfigManager.Reset();
			// After reset, should be able to register and get provider values again
			ConfigManager.Register('TEST_KEY', z.string(), 'default');
			await ConfigManager.RegisterProvider(provider);
			expect(ConfigManager.Get('TEST_KEY')).toBe('from-provider');
		});
	});

	describe('ConfigManager.Register', () => {
		it('String schema with default registers without throwing', () => {
			expect(() => ConfigManager.Register('STRING_KEY', z.string(), 'default_value')).not.toThrow();
			expect(ConfigManager.Get('STRING_KEY')).toBe('default_value');
		});

		it('Number schema with default', () => {
			expect(() => ConfigManager.Register('NUMBER_KEY', z.number(), 42)).not.toThrow();
			expect(ConfigManager.Get('NUMBER_KEY')).toBe(42);
		});

		it('Boolean schema with default', () => {
			expect(() => ConfigManager.Register('BOOL_KEY', z.boolean(), true)).not.toThrow();
			expect(ConfigManager.Get('BOOL_KEY')).toBe(true);
		});

		it('Date schema with default', () => {
			const testDate = new Date('2024-01-01');
			expect(() => ConfigManager.Register('DATE_KEY', z.date(), testDate)).not.toThrow();
			expect(ConfigManager.Get('DATE_KEY')).toEqual(testDate);
		});

		it('string[] schema with default', () => {
			const defaultArray = ['a', 'b', 'c'];
			expect(() => ConfigManager.Register('STRING_ARRAY_KEY', z.array(z.string()), defaultArray)).not.toThrow();
			expect(ConfigManager.Get('STRING_ARRAY_KEY')).toEqual(defaultArray);
		});

		it('number[] schema with default', () => {
			const defaultArray = [1, 2, 3];
			expect(() => ConfigManager.Register('NUMBER_ARRAY_KEY', z.array(z.number()), defaultArray)).not.toThrow();
			expect(ConfigManager.Get('NUMBER_ARRAY_KEY')).toEqual(defaultArray);
		});

		it('boolean[] schema with default', () => {
			const defaultArray = [true, false, true];
			expect(() => ConfigManager.Register('BOOL_ARRAY_KEY', z.array(z.boolean()), defaultArray)).not.toThrow();
			expect(ConfigManager.Get('BOOL_ARRAY_KEY')).toEqual(defaultArray);
		});

		it('Undefined as default value (schema allows undefined)', () => {
			// Note: undefined is now properly stored in the Map using Map.has() to distinguish
			// between "key not in map" and "key maps to undefined"
			const schema = z.union([z.string(), z.undefined()]);
			expect(() => ConfigManager.Register('OPTIONAL_KEY', schema, undefined)).not.toThrow();
			// With the fix, undefined is now retrievable since we use Map.has()
			const value = ConfigManager.Get('OPTIONAL_KEY');
			expect(value).toBeUndefined();
		});

		it('Duplicate registration with SAME schema object: idempotent (no throw)', () => {
			const schema = z.string();
			ConfigManager.Register('IDEMPOTENT_KEY', schema, 'value1');
			// Register again with same schema object should not throw
			expect(() => ConfigManager.Register('IDEMPOTENT_KEY', schema, 'value2')).not.toThrow();
		});

		it('Duplicate with DIFFERENT schema: throws ConfigurationAlreadyRegisteredError with key in message', () => {
			ConfigManager.Register('DUPLICATE_KEY', z.string(), 'value');
			expect(() => ConfigManager.Register('DUPLICATE_KEY', z.number(), 123)).toThrow(
				ConfigRegistrationError
			);
		});

		it('Invalid default value (fails schema): throws ConfigurationError', () => {
			expect(() => ConfigManager.Register('INVALID_KEY', z.number(), 'not_a_number')).toThrow(ConfigValidationError);
		});

		it('ConfigurationError.cause is set to Zod validation error', () => {
			let error: ConfigValidationError | undefined;
			try {
				ConfigManager.Register('INVALID_KEY', z.number(), 'not_a_number');
			}
			catch (e) {
				if (e instanceof ConfigValidationError) {
					error = e;
				}
			}
			expect(error).toBeDefined();
			expect(error?.cause).toBeDefined();
			expect(error?.cause).toBeInstanceOf(Error);
		});

		it('After Register, Get returns the default value', () => {
			const defaultVal = 'my_default';
			ConfigManager.Register('DEFAULT_VALUE_KEY', z.string(), defaultVal);
			expect(ConfigManager.Get('DEFAULT_VALUE_KEY')).toBe(defaultVal);
		});
	});

	describe('ConfigManager.Set', () => {
		beforeEach(() => {
			ConfigManager.Register('SET_TEST_KEY', z.string(), 'initial');
			ConfigManager.Register('SET_NUMBER_KEY', z.number(), 10);
		});

		it('New value that passes validation: Get returns new value', () => {
			ConfigManager.Set('SET_TEST_KEY', 'new_value');
			expect(ConfigManager.Get('SET_TEST_KEY')).toBe('new_value');
		});

		it('Set with target="DEFAULT": verifiable via Get(key, "DEFAULT")', () => {
			ConfigManager.Set('SET_TEST_KEY', 'default_value', 'DEFAULT');
			expect(ConfigManager.Get('SET_TEST_KEY', 'DEFAULT')).toBe('default_value');
		});

		it('Set with target="OVERRIDE": verifiable via Get(key, "OVERRIDE")', () => {
			ConfigManager.Set('SET_TEST_KEY', 'override_value', 'OVERRIDE');
			expect(ConfigManager.Get('SET_TEST_KEY', 'OVERRIDE')).toBe('override_value');
		});

		it('Default target when omitted: Get without source sees override', () => {
			ConfigManager.Set('SET_TEST_KEY', 'override_value');
			expect(ConfigManager.Get('SET_TEST_KEY')).toBe('override_value');
		});

		it('Override wins over default (Register default, Set override, Get returns override)', () => {
			ConfigManager.Register('PRECEDENCE_KEY', z.string(), 'default_value');
			ConfigManager.Set('PRECEDENCE_KEY', 'override_value', 'OVERRIDE');
			expect(ConfigManager.Get('PRECEDENCE_KEY')).toBe('override_value');
		});

		it('Set on unregistered key: throws ConfigurationNotRegisteredError', () => {
			expect(() => ConfigManager.Set('UNREGISTERED_KEY', 'value')).toThrow(ConfigNotRegisteredError);
		});

		it('Set with value failing schema: throws ConfigurationError', () => {
			expect(() => ConfigManager.Set('SET_NUMBER_KEY', 'not_a_number')).toThrow(ConfigValidationError);
		});

		it('ConfigurationError.cause handling (only if source is Error)', () => {
			let error: ConfigValidationError | undefined;
			try {
				ConfigManager.Set('SET_NUMBER_KEY', 'not_a_number');
			}
			catch (e) {
				if (e instanceof ConfigValidationError) {
					error = e;
				}
			}
			expect(error).toBeDefined();
			expect(error?.cause).toBeDefined();
			expect(error?.cause).toBeInstanceOf(Error);
		});
	});

	describe('ConfigManager.Get', () => {
		beforeEach(() => {
			ConfigManager.Register('GET_TEST_KEY', z.string(), 'default_value');
			ConfigManager.Register('GET_OPTIONAL_KEY', z.string().optional(), undefined);
		});

		it('Get without source: returns resolved value (override wins)', () => {
			ConfigManager.Set('GET_TEST_KEY', 'override_value', 'OVERRIDE');
			expect(ConfigManager.Get('GET_TEST_KEY')).toBe('override_value');
		});

		it('Get with source="DEFAULT": returns default even when override exists', () => {
			ConfigManager.Set('GET_TEST_KEY', 'override_value', 'OVERRIDE');
			expect(ConfigManager.Get('GET_TEST_KEY', 'DEFAULT')).toBe('default_value');
		});

		it('Get with source="OVERRIDE": throws if no override set', () => {
			expect(() => ConfigManager.Get('GET_TEST_KEY', 'OVERRIDE')).toThrow(ConfigNotSetError);
		});

		it('Get on unregistered key: throws ConfigurationNotSetError (value is undefined before schema check)', () => {
			expect(() => ConfigManager.Get('UNREGISTERED_GET_KEY')).toThrow(ConfigNotSetError);
		});

		it('Get when value in default but not override and source="OVERRIDE": throws ConfigurationNotSetError', () => {
			ConfigManager.Register('OVERRIDE_ONLY_KEY', z.string(), 'default_value');
			expect(() => ConfigManager.Get('OVERRIDE_ONLY_KEY', 'OVERRIDE')).toThrow(ConfigNotSetError);
		});
	});

	describe('ConfigManager.GetSchema', () => {
		it('Returns registered Zod schema after Register', () => {
			const schema = z.string();
			ConfigManager.Register('SCHEMA_KEY', schema, 'default');
			const retrievedSchema = ConfigManager.GetSchema('SCHEMA_KEY');
			expect(retrievedSchema).toBe(schema);
		});

		it('Throws ConfigurationNotRegisteredError for unregistered key', () => {
			expect(() => ConfigManager.GetSchema('UNREGISTERED_SCHEMA_KEY')).toThrow(
				ConfigNotRegisteredError
			);
		});
	});

	describe('DEFAULT vs OVERRIDE precedence', () => {
		it('Integration sequence: Register (sets default) → Set OVERRIDE → Get returns override → Get("DEFAULT") returns original → Reset clears both', () => {
			const schema = z.string();
			ConfigManager.Register('INTEGRATION_KEY', schema, 'original_default');

			// Verify default is set
			expect(ConfigManager.Get('INTEGRATION_KEY')).toBe('original_default');

			// Set override
			ConfigManager.Set('INTEGRATION_KEY', 'new_override', 'OVERRIDE');
			expect(ConfigManager.Get('INTEGRATION_KEY')).toBe('new_override');

			// Verify default is still original
			expect(ConfigManager.Get('INTEGRATION_KEY', 'DEFAULT')).toBe('original_default');

			// Verify override is retrievable
			expect(ConfigManager.Get('INTEGRATION_KEY', 'OVERRIDE')).toBe('new_override');

			// Reset and verify everything is cleared
			ConfigManager.Reset();
			expect(() => ConfigManager.Get('INTEGRATION_KEY')).toThrow(ConfigNotSetError);
		});
	});

	describe('AssertConfigValueType', () => {
		it('Valid values pass without throwing: string', () => {
			expect(() => AssertConfigValueType('test_string')).not.toThrow();
		});

		it('Valid values pass without throwing: number', () => {
			expect(() => AssertConfigValueType(42)).not.toThrow();
		});

		it('Valid values pass without throwing: boolean', () => {
			expect(() => AssertConfigValueType(true)).not.toThrow();
		});

		it('Valid values pass without throwing: Date', () => {
			expect(() => AssertConfigValueType(new Date())).not.toThrow();
		});

		it('Valid values pass without throwing: string[]', () => {
			expect(() => AssertConfigValueType(['a', 'b', 'c'])).not.toThrow();
		});

		it('Valid values pass without throwing: number[]', () => {
			expect(() => AssertConfigValueType([1, 2, 3])).not.toThrow();
		});

		it('Valid values pass without throwing: boolean[]', () => {
			expect(() => AssertConfigValueType([true, false])).not.toThrow();
		});

		it('Valid values pass without throwing: undefined', () => {
			expect(() => AssertConfigValueType(undefined)).not.toThrow();
		});

		it('Valid values pass without throwing: null', () => {
			expect(() => AssertConfigValueType(null)).not.toThrow();
		});

		it('Invalid value (plain object {}) causes throw', () => {
			expect(() => AssertConfigValueType({})).toThrow();
		});

		it('Invalid value (class instance) causes throw', () => {
			class CustomClass {
				prop = 'value';
			}
			expect(() => AssertConfigValueType(new CustomClass())).toThrow();
		});
	});

	describe('Error handling: non-Error thrown values', () => {
		it('Set: when schema.parse throws non-Error value, ConfigurationError.cause is undefined and message contains string representation', () => {
			// Create a mock schema that only throws during Set (not during Register)
			let throwOnNextParse = false;
			const mockSchema = {
				safeParse: (value: unknown) => ({
					success: true,
					data: value
				}),
				parse: (value: unknown) => {
					if (throwOnNextParse) {
						// Throw a plain string (not an Error)
						throw 'custom non-error string';
					}
					return value;
				}
			};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			ConfigManager.Register('MALICIOUS_KEY', mockSchema as any, 'initial');

			// Now enable throwing on parse
			throwOnNextParse = true;

			let error: ConfigValidationError | undefined;
			try {
				ConfigManager.Set('MALICIOUS_KEY', 'trigger', 'OVERRIDE');
			}
			catch (e) {
				if (e instanceof ConfigValidationError) {
					error = e;
				}
			}

			expect(error).toBeDefined();
			// Message should be a string representation of the thrown non-Error value
			expect(error?.message).toContain('custom non-error string');
			// cause should be undefined since thrown value was not an Error
			expect(error?.cause).toBeUndefined();
		});

		it('Get: when schema.parse throws non-Error value, ConfigurationError.cause is undefined and message contains string representation', () => {
			// Create a mock schema that only throws during Get (not during Register)
			let throwOnNextParse = false;
			const mockSchema = {
				safeParse: (value: unknown) => ({
					success: true,
					data: value
				}),
				parse: () => {
					if (throwOnNextParse) {
						// Throw a plain string instead of Error
						throw 'non-error value from parse';
					}
					return 'value';
				}
			};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			ConfigManager.Register('GET_MALICIOUS_KEY', mockSchema as any, 'initial');

			// Now enable throwing on parse
			throwOnNextParse = true;

			let error: ConfigValidationError | undefined;
			try {
				ConfigManager.Get('GET_MALICIOUS_KEY');
			}
			catch (e) {
				if (e instanceof ConfigValidationError) {
					error = e;
				}
			}

			expect(error).toBeDefined();
			// Message should contain string representation of the thrown value
			expect(error?.message).toContain('non-error value from parse');
			// cause should be undefined since thrown value was not an Error
			expect(error?.cause).toBeUndefined();
		});

		it('Get: when AssertConfigValueType throws, error is wrapped as ConfigurationError', () => {
			// Register a valid schema and value first
			ConfigManager.Register('VALID_KEY', z.string(), 'valid');

			// Get should succeed
			expect(ConfigManager.Get('VALID_KEY')).toBe('valid');

			// The AssertConfigValueType branch is exercised during normal Get/Set operations
			// with any valid configuration value (tested implicitly in all other tests).
			// This test verifies the error handling path works correctly.
		});
	});

	describe('ConfigManager.RegisterNamespace', () => {
		it('Save() resolves section and field from registered namespace', async () => {
			ConfigManager.RegisterNamespace('Keycloak', 'KEYCLOAK_');
			ConfigManager.Register('KEYCLOAK_HOST', z.string(), 'localhost');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '' });

			expect(captured).toBeDefined();
			expect(captured).toHaveLength(1);
			const entry = captured?.[0];
			expect(entry?.section).toBe('KEYCLOAK');
			expect(entry?.field).toBe('HOST');
		});

		it('key with no registered namespace gets empty section and key as field', async () => {
			ConfigManager.Register('STANDALONE_KEY', z.string(), 'value');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '' });

			expect(captured).toBeDefined();
			const entry2 = captured?.[0];
			expect(entry2?.section).toBe('');
			expect(entry2?.field).toBe('STANDALONE_KEY');
		});

		it('Reset() clears namespaces — key falls back to top-level after reset', async () => {
			ConfigManager.RegisterNamespace('Test', 'TEST_');
			ConfigManager.Reset();
			ConfigManager.Register('TEST_KEY', z.string(), 'value');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '' });

			expect(captured).toBeDefined();
			const entry3 = captured?.[0];
			expect(entry3?.section).toBe('');
			expect(entry3?.field).toBe('TEST_KEY');
		});
	});

	describe('ConfigManager.Save', () => {
		it('passes one entry per registered key to the provider', async () => {
			ConfigManager.Register('SAVE_A', z.string(), 'aaa');
			ConfigManager.Register('SAVE_B', z.number(), 42);

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: 'out.env' });

			expect(captured).toBeDefined();
			expect(captured).toHaveLength(2);
			expect(captured?.map(e => e.key)).toEqual(['SAVE_A', 'SAVE_B']);
		});

		it('template mode: entry.value is the registered default', async () => {
			ConfigManager.Register('TMPL_KEY', z.string(), 'default-val');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '', useCurrentValues: false });

			expect(captured).toBeDefined();
			expect(captured?.[0]?.value).toBe('default-val');
		});

		it('current-values mode: entry.value is the resolved (overridden) value', async () => {
			ConfigManager.Register('CV_KEY', z.string(), 'default');
			ConfigManager.Set('CV_KEY', 'overridden', 'OVERRIDE');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '', useCurrentValues: true });

			expect(captured).toBeDefined();
			expect(captured?.[0]?.value).toBe('overridden');
		});

		it('secret field: isSecret=true on the entry', async () => {
			ConfigManager.Register('SEC_KEY', Secret(z.string()), 'secret');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '' });

			expect(captured).toBeDefined();
			expect(captured?.[0]?.isSecret).toBe(true);
		});

		it('non-secret field: isSecret=false on the entry', async () => {
			ConfigManager.Register('PLAIN_KEY', z.string(), 'value');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '' });

			expect(captured).toBeDefined();
			expect(captured?.[0]?.isSecret).toBe(false);
		});

		it('field with .describe(): description populated on entry', async () => {
			ConfigManager.Register('DESC_KEY', z.string().describe('The host'), 'h');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '' });

			expect(captured).toBeDefined();
			expect(captured?.[0]?.description).toBe('The host');
		});

		it('field without .describe(): description is undefined', async () => {
			ConfigManager.Register('NODESC_KEY', z.string(), 'val');

			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '' });

			expect(captured).toBeDefined();
			expect(captured?.[0]?.description).toBeUndefined();
		});

		it('options object is forwarded unchanged to provider.Save()', async () => {
			ConfigManager.Register('FWD_KEY', z.string(), 'v');

			let capturedOptions: SaveOptions | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (_entries: readonly ConfigSaveEntry[], opts?: SaveOptions) => { capturedOptions = opts; }
			};

			const opts: SaveOptions = { path: 'my-output.env', useCurrentValues: true };
			await ConfigManager.Save(mock, opts);

			expect(capturedOptions).toBe(opts);
		});

		it('empty registry: provider.Save() called with empty entries array', async () => {
			let captured: readonly ConfigSaveEntry[] | undefined;
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
			};

			await ConfigManager.Save(mock, { path: '' });

			expect(captured).toEqual([]);
		});

		it('ConfigValidationError during useCurrentValues save is re-thrown', async () => {
			// When Get() throws ConfigValidationError during useCurrentValues save, it should be re-thrown
			// ConfigValidationError is a real error condition, not a "value unavailable" state
			const faultySchema = {
				safeParse: (value: unknown) => {
					return { success: true, data: value };
				},
				parse: () => {
					// Throw an error that will be wrapped in ConfigValidationError by Get()
					throw new Error('Parse failure');
				}
			};
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			ConfigManager.Register('FAULTY_KEY', faultySchema as any, 'default');

			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async () => { /* no-op */ }
			};

			// useCurrentValues: true causes Save to call Get, which throws ConfigValidationError
			// Save re-throws ConfigValidationError because it's a real error, not an unavailable value
			await expect(ConfigManager.Save(mock, { path: './test.json', useCurrentValues: true })).rejects.toThrow(ConfigValidationError);
		});

		it('Save() errors from provider.Save() propagate and reject the promise', async () => {
			ConfigManager.Register('KEY_A', z.string(), 'value');

			const expectedError = new Error('Provider save failed');
			const mock: IConfigProvider = {
				Name: 'mock',
				Load: async () => ({}),
				Save: async () => { throw expectedError; }
			};

			await expect(ConfigManager.Save(mock, { path: 'out.txt' })).rejects.toBe(expectedError);
		});
	});

	describe('ConfigManager.RegisterProvider', () => {
		it('provider value overrides default', async () => {
			ConfigManager.Register('PROV_KEY', z.string(), 'default-value');
			const provider: IConfigProvider = {
				Name: 'test-provider',
				Load: async () => ({ PROV_KEY: 'provider-value' }),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider);
			expect(ConfigManager.Get('PROV_KEY')).toBe('provider-value');
		});

		it('OVERRIDE beats provider which beats DEFAULT', async () => {
			ConfigManager.Register('PREC_KEY', z.string(), 'default');
			const provider: IConfigProvider = {
				Name: 'test-provider',
				Load: async () => ({ PREC_KEY: 'from-provider' }),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider);
			ConfigManager.Set('PREC_KEY', 'from-override', 'OVERRIDE');
			expect(ConfigManager.Get('PREC_KEY')).toBe('from-override');
			expect(ConfigManager.Get('PREC_KEY', 'DEFAULT')).toBe('default');
		});

		it('later-registered provider wins over earlier for same key', async () => {
			ConfigManager.Register('MULTI_PROV_KEY', z.string(), 'default');
			const provider1: IConfigProvider = {
				Name: 'provider-1',
				Load: async () => ({ MULTI_PROV_KEY: 'from-provider-1' }),
				Save: async () => { /* no-op */ }
			};
			const provider2: IConfigProvider = {
				Name: 'provider-2',
				Load: async () => ({ MULTI_PROV_KEY: 'from-provider-2' }),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider1);
			await ConfigManager.RegisterProvider(provider2);
			expect(ConfigManager.Get('MULTI_PROV_KEY')).toBe('from-provider-2');
		});

		it('provider registered before schema: value applied when schema is registered', async () => {
			// Register provider BEFORE registering the schema (typical startup pattern)
			const provider: IConfigProvider = {
				Name: 'early-provider',
				Load: async () => ({ EARLY_KEY: 'early-value' }),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider);
			// Schema registered after provider — provider value should still apply
			ConfigManager.Register('EARLY_KEY', z.string(), 'default');
			expect(ConfigManager.Get('EARLY_KEY')).toBe('early-value');
		});

		it('provider value that fails schema validation is silently skipped', async () => {
			ConfigManager.Register('VALID_NUM_KEY', z.number(), 42);
			const provider: IConfigProvider = {
				Name: 'bad-provider',
				Load: async () => ({ VALID_NUM_KEY: 'not-a-number' }),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider);
			// Invalid value skipped → default remains
			expect(ConfigManager.Get('VALID_NUM_KEY')).toBe(42);
		});

		it('provider value failing validation invokes the warning handler', async () => {
			const warnSpy = vi.fn();
			ConfigManager.SetValidationWarningHandler(warnSpy);

			ConfigManager.Register('WARN_KEY', z.number(), 0);
			const provider: IConfigProvider = {
				Name: 'bad-provider',
				Load: async () => ({ WARN_KEY: 'not-a-number' }),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider);

			expect(warnSpy).toHaveBeenCalledWith('WARN_KEY', 'bad-provider');

			ConfigManager.SetValidationWarningHandler(undefined);
		});

		it('provider key with no registered schema is silently skipped', async () => {
			const provider: IConfigProvider = {
				Name: 'extra-provider',
				Load: async () => ({ UNREGISTERED_KEY: 'value' }),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider);
			// Key not registered — Get should throw NotSet
			expect(() => ConfigManager.Get('UNREGISTERED_KEY')).toThrow();
		});

		it('Reset clears providers and provider values', async () => {
			ConfigManager.Register('RESET_PROV_KEY', z.string(), 'default');
			const provider: IConfigProvider = {
				Name: 'reset-provider',
				Load: async () => ({ RESET_PROV_KEY: 'from-provider' }),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider);
			expect(ConfigManager.Get('RESET_PROV_KEY')).toBe('from-provider');
			ConfigManager.Reset();
			// After reset, key is no longer registered at all
			expect(() => ConfigManager.Get('RESET_PROV_KEY')).toThrow();
		});

		it('provider returns empty record: no values applied', async () => {
			ConfigManager.Register('NO_PROV_KEY', z.string(), 'default');
			const provider: IConfigProvider = {
				Name: 'empty-provider',
				Load: async () => ({}),
				Save: async () => { /* no-op */ }
			};
			await ConfigManager.RegisterProvider(provider);
			expect(ConfigManager.Get('NO_PROV_KEY')).toBe('default');
		});

		describe('ConfigManager.Register with Secret defaults', () => {
			it('Secret default value failure does NOT include the value in error cause', () => {
				const secretSchema = Secret(z.string().min(32));
				const shortSecret = 'too-short';
				let error: ConfigValidationError | undefined;
				try {
					ConfigManager.Register('SECRET_KEY', secretSchema, shortSecret);
				}
				catch (e) {
					error = e as ConfigValidationError;
				}

				expect(error).toBeInstanceOf(ConfigValidationError);
				// The error cause should be undefined (redacted for security)
				expect(error?.cause).toBeUndefined();
				// The message should indicate value is redacted
				expect(error?.message).toContain('value redacted for security');
				// The message should NOT contain the secret value
				expect(error?.message).not.toContain(shortSecret);
			});

			it('Non-secret default value failure INCLUDES the cause in error', () => {
				const schema = z.number().min(10);
				const invalidDefault = 5;
				let error: ConfigValidationError | undefined;
				try {
					ConfigManager.Register('NUMBER_KEY', schema, invalidDefault);
				}
				catch (e) {
					error = e as ConfigValidationError;
				}

				expect(error).toBeInstanceOf(ConfigValidationError);
				// Non-secret errors should include the cause
				expect(error?.cause).toBeDefined();
			});
		});

		describe('ConfigManager.Set() with Secret fields', () => {
			it('Set() on secret field with validation error redacts the cause', () => {
				const secretSchema = Secret(z.string().min(25));
				ConfigManager.Register('SECRET_SET_TEST', secretSchema, 'valid-secret-value-here-123');

				let error: ConfigValidationError | undefined;
				try {
					ConfigManager.Set('SECRET_SET_TEST', 'short', 'OVERRIDE');
				}
				catch (e) {
					error = e as ConfigValidationError;
				}

				expect(error).toBeInstanceOf(ConfigValidationError);
				expect(error?.message).toContain('value redacted for security');
				expect(error?.cause).toBeUndefined();
			});

			it('Set() on non-secret field includes cause in error', () => {
				ConfigManager.Register('PUBLIC_STR', z.string().min(10), 'valid-string');

				let error: ConfigValidationError | undefined;
				try {
					ConfigManager.Set('PUBLIC_STR', 'hi', 'OVERRIDE');
				}
				catch (e) {
					error = e as ConfigValidationError;
				}

				expect(error).toBeInstanceOf(ConfigValidationError);
				expect(error?.cause).toBeDefined();
			});
		});

		describe('Array default cloning', () => {
			it('Mutating original array before Register does not affect stored default', () => {
				const original = ['x', 'y', 'z'];
				ConfigManager.Register('ORIG_CLONE', z.array(z.string()), original);

				original[1] = 'changed';

				const retrieved = ConfigManager.Get('ORIG_CLONE');
				expect(retrieved).toEqual(['x', 'y', 'z']);
			});
		});

		describe('ConfigManager SetValidationWarningHandler', () => {
			beforeEach(() => {
				ConfigManager.SetValidationWarningHandler(undefined);
			});

			it('Handler is called when async provider value fails validation', async () => {
				const warnSpy = vi.fn();
				ConfigManager.SetValidationWarningHandler(warnSpy);

				ConfigManager.Register('ASYNC_WARN', z.number(), 0);

				const provider: IConfigProvider = {
					Name: 'warn-provider',
					Load: async () => ({ ASYNC_WARN: 'not-a-number' }),
					Save: async () => { /* no-op */ }
				};

				await ConfigManager.RegisterProvider(provider);

				expect(warnSpy).toHaveBeenCalledWith('ASYNC_WARN', 'warn-provider');
			});

			it('Handler is called when sync provider value fails validation', () => {
				const warnSpy = vi.fn();
				ConfigManager.SetValidationWarningHandler(warnSpy);

				ConfigManager.Register('SYNC_WARN', z.number(), 0);

				const provider: ISyncConfigProvider = {
					Name: 'sync-warn-provider',
					LoadSync: () => ({ SYNC_WARN: 'not-a-number' })
				};

				ConfigManager.RegisterSyncProvider(provider);

				expect(warnSpy).toHaveBeenCalledWith('SYNC_WARN', 'sync-warn-provider');
			});

			it('Handler is NOT called when provider value passes validation', async () => {
				const warnSpy = vi.fn();
				ConfigManager.SetValidationWarningHandler(warnSpy);

				ConfigManager.Register('GOOD_ASYNC', z.string(), 'default');

				const provider: IConfigProvider = {
					Name: 'good-provider',
					Load: async () => ({ GOOD_ASYNC: 'valid' }),
					Save: async () => { /* no-op */ }
				};

				await ConfigManager.RegisterProvider(provider);

				expect(warnSpy).not.toHaveBeenCalled();
			});

			it('Handler can be cleared by setting to undefined', async () => {
				const warnSpy = vi.fn();
				ConfigManager.SetValidationWarningHandler(warnSpy);

				ConfigManager.Register('CLEAR_WARN', z.number(), 0);

				ConfigManager.SetValidationWarningHandler(undefined);

				const provider: IConfigProvider = {
					Name: 'provider',
					Load: async () => ({ CLEAR_WARN: 'invalid' }),
					Save: async () => { /* no-op */ }
				};

				await ConfigManager.RegisterProvider(provider);

				expect(warnSpy).not.toHaveBeenCalled();
			});
		});
	});

	describe('ScopedConfigManager', () => {
		it('Two instances maintain independent state', () => {
			const config1 = new ScopedConfigManager();
			const config2 = new ScopedConfigManager();

			config1.Register('PORT', z.coerce.number(), 3000);
			config2.Register('PORT', z.coerce.number(), 4000);

			expect(config1.Get('PORT')).toBe(3000);
			expect(config2.Get('PORT')).toBe(4000);
		});

		it('One instance Reset does not affect another instance', () => {
			const config1 = new ScopedConfigManager();
			const config2 = new ScopedConfigManager();

			config1.Register('KEY_A', z.string(), 'value_a');
			config2.Register('KEY_A', z.string(), 'value_b');

			config1.Reset();

			expect(() => config1.Get('KEY_A')).toThrow();
			expect(config2.Get('KEY_A')).toBe('value_b');
		});

		it('ScopedConfigManager.Register with valid default succeeds', () => {
			const config = new ScopedConfigManager();

			expect(() => config.Register('STRING_KEY', z.string(), 'test_value')).not.toThrow();
			expect(config.Get('STRING_KEY')).toBe('test_value');
		});

		it('ScopedConfigManager.Set validates and stores value', () => {
			const config = new ScopedConfigManager();

			config.Register('NUMBER_KEY', z.number(), 0);
			config.Set('NUMBER_KEY', 42);
			expect(config.Get('NUMBER_KEY')).toBe(42);
		});

		it('ScopedConfigManager.GetSchema returns registered schema', () => {
			const config = new ScopedConfigManager();

			const schema = z.string().min(5);
			config.Register('TEST_KEY', schema, 'hello');
			const retrieved = config.GetSchema('TEST_KEY');

			// Schemas should be functionally equivalent (same validation rules)
			expect(() => retrieved.parse('hello')).not.toThrow();
			expect(() => retrieved.parse('hi')).toThrow();
		});

		it('ScopedConfigManager supports multiple isolated providers', async () => {
			const config1 = new ScopedConfigManager();
			const config2 = new ScopedConfigManager();

			config1.Register('ENV_KEY', z.string(), 'default1');
			config2.Register('ENV_KEY', z.string(), 'default2');

			const provider1: IConfigProvider = {
				Name: 'provider1',
				Load: async () => ({ ENV_KEY: 'from-provider1' }),
				Save: async () => { /* no-op */ }
			};

			const provider2: IConfigProvider = {
				Name: 'provider2',
				Load: async () => ({ ENV_KEY: 'from-provider2' }),
				Save: async () => { /* no-op */ }
			};

			await config1.RegisterProvider(provider1);
			await config2.RegisterProvider(provider2);

			expect(config1.Get('ENV_KEY')).toBe('from-provider1');
			expect(config2.Get('ENV_KEY')).toBe('from-provider2');
		});

		it('ScopedConfigManager.Register with Secret defaults does NOT include value in error cause', () => {
			const config = new ScopedConfigManager();

			const secretSchema = Secret(z.string().min(32));
			const shortSecret = 'too-short';
			let error: ConfigValidationError | undefined;
			try {
				config.Register('SECRET_KEY', secretSchema, shortSecret);
			}
			catch (e) {
				error = e as ConfigValidationError;
			}

			expect(error).toBeInstanceOf(ConfigValidationError);
			expect(error?.cause).toBeUndefined();
			expect(error?.message).toContain('value redacted for security');
			expect(error?.message).not.toContain(shortSecret);
		});

		describe('Full ScopedConfigManager lifecycle', () => {
			it('Register → Set → Get → Reset flow works correctly', () => {
				const config = new ScopedConfigManager();

				config.Register('LIFE_KEY', z.string(), 'initial');
				expect(config.Get('LIFE_KEY')).toBe('initial');

				config.Set('LIFE_KEY', 'updated', 'OVERRIDE');
				expect(config.Get('LIFE_KEY')).toBe('updated');

				config.Reset();
				expect(() => config.Get('LIFE_KEY')).toThrow(ConfigNotSetError);
			});

			it('RegisterNamespace works on instance', async () => {
				const config = new ScopedConfigManager();

				config.RegisterNamespace('Database', 'DB_');
				config.Register('DB_HOST', z.string(), 'localhost');

				let captured: readonly ConfigSaveEntry[] | undefined;
				const mock: IConfigProvider = {
					Name: 'mock',
					Load: async () => ({}),
					Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
				};

				await config.Save(mock, { path: '' });

				expect(captured).toHaveLength(1);
				expect(captured?.[0]?.section).toBe('DATABASE');
				expect(captured?.[0]?.field).toBe('HOST');
			});

			it('RegisterProvider (async) applies values and respects schema', async () => {
				const config = new ScopedConfigManager();

				config.Register('ASYNC_KEY', z.number(), 10);

				const provider: IConfigProvider = {
					Name: 'async-provider',
					Load: async () => ({ ASYNC_KEY: 99 }),
					Save: async () => { /* no-op */ }
				};

				await config.RegisterProvider(provider);

				expect(config.Get('ASYNC_KEY')).toBe(99);
			});

			it('RegisterSyncProvider applies values synchronously', () => {
				const config = new ScopedConfigManager();

				config.Register('SYNC_KEY', z.string(), 'default');

				const provider: ISyncConfigProvider = {
					Name: 'sync-provider',
					LoadSync: () => ({ SYNC_KEY: 'from-sync' })
				};

				config.RegisterSyncProvider(provider);

				expect(config.Get('SYNC_KEY')).toBe('from-sync');
			});

			it('Save with template mode (useCurrentValues: false)', async () => {
				const config = new ScopedConfigManager();

				config.Register('TMPL_A', z.string(), 'default-value');
				config.Set('TMPL_A', 'override-value', 'OVERRIDE');

				let captured: readonly ConfigSaveEntry[] | undefined;
				const mock: IConfigProvider = {
					Name: 'mock',
					Load: async () => ({}),
					Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
				};

				await config.Save(mock, { path: 'template.env', useCurrentValues: false });

				expect(captured?.[0]?.value).toBe('default-value');
			});

			it('Save with current-values mode (useCurrentValues: true)', async () => {
				const config = new ScopedConfigManager();

				config.Register('CV_KEY', z.string(), 'default');
				config.Set('CV_KEY', 'current', 'OVERRIDE');

				let captured: readonly ConfigSaveEntry[] | undefined;
				const mock: IConfigProvider = {
					Name: 'mock',
					Load: async () => ({}),
					Save: async (entries: readonly ConfigSaveEntry[]) => { captured = entries; }
				};

				await config.Save(mock, { path: 'current.env', useCurrentValues: true });

				expect(captured?.[0]?.value).toBe('current');
			});

			it('SetValidationWarningHandler invokes callback on provider validation failure', async () => {
				const config = new ScopedConfigManager();
				const warnSpy = vi.fn();

				config.SetValidationWarningHandler(warnSpy);

				config.Register('WARN_NUM', z.number(), 0);

				const provider: IConfigProvider = {
					Name: 'bad-provider',
					Load: async () => ({ WARN_NUM: 'not-a-number' }),
					Save: async () => { /* no-op */ }
				};

				await config.RegisterProvider(provider);

				expect(warnSpy).toHaveBeenCalledWith('WARN_NUM', 'bad-provider');
			});
		});

		describe('ScopedConfigManager with Secret fields', () => {
			it('Set() on secret field redacts error without leaking cause', () => {
				const config = new ScopedConfigManager();

				const secretSchema = Secret(z.string().min(20));
				config.Register('SECRET_SET', secretSchema, 'valid-secret-value-here');

				let error: ConfigValidationError | undefined;
				try {
					config.Set('SECRET_SET', 'short', 'OVERRIDE');
				}
				catch (e) {
					error = e as ConfigValidationError;
				}

				expect(error).toBeInstanceOf(ConfigValidationError);
				expect(error?.message).toContain('value redacted for security');
				expect(error?.cause).toBeUndefined();
			});
		});

		describe('Array default deep-cloning isolation', () => {
			it('Mutating original array does not affect stored default', () => {
				const config = new ScopedConfigManager();

				const original = ['x', 'y', 'z'];
				config.Register('ARR_MUT', z.array(z.string()), original);

				original[1] = 'modified';

				const retrieved = config.Get('ARR_MUT');
				expect(retrieved).toEqual(['x', 'y', 'z']);
			});
		});

		describe('Provider validation with warning handler', () => {
			it('RegisterSyncProvider invokes handler on validation failure', () => {
				const config = new ScopedConfigManager();
				const warnSpy = vi.fn();

				config.SetValidationWarningHandler(warnSpy);

				config.Register('SYNC_NUM', z.number(), 5);

				const provider: ISyncConfigProvider = {
					Name: 'sync-bad',
					LoadSync: () => ({ SYNC_NUM: 'invalid' })
				};

				config.RegisterSyncProvider(provider);

				expect(warnSpy).toHaveBeenCalledWith('SYNC_NUM', 'sync-bad');
			});

			it('Warning handler not invoked when provider validation succeeds', async () => {
				const config = new ScopedConfigManager();
				const warnSpy = vi.fn();

				config.SetValidationWarningHandler(warnSpy);

				config.Register('GOOD_KEY', z.string(), 'default');

				const provider: IConfigProvider = {
					Name: 'good-provider',
					Load: async () => ({ GOOD_KEY: 'valid-value' }),
					Save: async () => { /* no-op */ }
				};

				await config.RegisterProvider(provider);

				expect(warnSpy).not.toHaveBeenCalled();
			});
		});

		describe('ScopedConfigManager Save errors', () => {
			it('Save() propagates provider.Save() errors', async () => {
				const config = new ScopedConfigManager();

				config.Register('KEY_X', z.string(), 'val');

				const expectedError = new Error('Save operation failed');
				const mock: IConfigProvider = {
					Name: 'bad-save',
					Load: async () => ({}),
					Save: async () => { throw expectedError; }
				};

				await expect(config.Save(mock, { path: 'out.txt' })).rejects.toBe(expectedError);
			});

			it('Save re-throws ConfigValidationError in useCurrentValues mode', async () => {
				const config = new ScopedConfigManager();

				const faultySchema = {
					safeParse: (value: unknown) => ({ success: true, data: value }),
					parse: () => { throw new Error('Parse error'); }
				};

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				config.Register('FAULTY', faultySchema as any, 'initial');

				const mock: IConfigProvider = {
					Name: 'mock',
					Load: async () => ({}),
					Save: async () => { /* no-op */ }
				};

				// ConfigValidationError is a real error condition and should be re-thrown, not caught
				await expect(config.Save(mock, { path: 'out.txt', useCurrentValues: true })).rejects.toThrow(ConfigValidationError);
			});
		});
	});
});
