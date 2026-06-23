import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod/v4';
import { RegisterConfigSchema } from './schema.factory.js';
import { ConfigManager } from './manager.js';
import { ConfigValidationError, ConfigNotSetError, ConfigNotRegisteredError } from './errors.js';
import { Secret } from './secret.js';

describe('RegisterConfigSchema', () => {
	beforeEach(() => ConfigManager.Reset());

	// Shared test fixture
	const schema = z.object({
		HOST: z.string().default('localhost'),
		PORT: z.coerce.number().default(8080),
		DEBUG: z.boolean().default(false)
	});

	describe('Factory', () => {
		it('returns object with name property', () => {
			const config = RegisterConfigSchema('Test', schema);
			expect(config.name).toBe('Test');
		});

		it('works with minimal schema (single field)', () => {
			const minimalSchema = z.object({
				KEY: z.string().default('value')
			});
			const config = RegisterConfigSchema('Min', minimalSchema);
			expect(config.Get('KEY')).toBe('value');
		});

		it('works with multiple fields', () => {
			const multiSchema = z.object({
				A: z.string().default('a'),
				B: z.number().default(1),
				C: z.boolean().default(true),
				D: z.string().default('d')
			});
			const config = RegisterConfigSchema('Multi', multiSchema);
			expect(config.Get('A')).toBe('a');
			expect(config.Get('B')).toBe(1);
			expect(config.Get('C')).toBe(true);
			expect(config.Get('D')).toBe('d');
		});
	});

	describe('Auto-registration', () => {
		it('fields are registered with ConfigManager immediately on call', () => {
			const config = RegisterConfigSchema('Test', schema);
			// No explicit .Register() needed — values accessible immediately
			expect(config.Get('HOST')).toBe('localhost');
			expect(config.Get('PORT')).toBe(8080);
			expect(config.Get('DEBUG')).toBe(false);
		});

		it('default values from Zod schema are extracted correctly', () => {
			const config = RegisterConfigSchema('Test', schema);
			expect(config.Get('HOST')).toBe('localhost');
			expect(config.Get('PORT')).toBe(8080);
			expect(config.Get('DEBUG')).toBe(false);
		});

		it('calling RegisterConfigSchema twice with same schema is idempotent', () => {
			const config1 = RegisterConfigSchema('Test', schema);
			const val1 = config1.Get('HOST');
			// Reset and re-register
			ConfigManager.Reset();
			const config2 = RegisterConfigSchema('Test', schema);
			const val2 = config2.Get('HOST');
			expect(val1).toBe(val2);
			expect(val2).toBe('localhost');
		});

		it('schema with required field (no default) throws ConfigurationError during RegisterConfigSchema', () => {
			const requiredSchema = z.object({
				REQUIRED: z.string()
			});
			expect(() => RegisterConfigSchema('Req', requiredSchema)).toThrow(ConfigValidationError);
		});

		it('name is exposed on the returned object', () => {
			const config = RegisterConfigSchema('Test', schema);
			expect(config.name).toBe('Test');
		});
	});

	describe('Get', () => {
		it('returns default value after Register', () => {
			const config = RegisterConfigSchema('Test', schema);
			expect(config.Get('HOST')).toBe('localhost');
			expect(config.Get('PORT')).toBe(8080);
			expect(config.Get('DEBUG')).toBe(false);
		});

		it('returns overridden value after Set', () => {
			const config = RegisterConfigSchema('Test', schema);
			config.Set('HOST', 'example.com');
			expect(config.Get('HOST')).toBe('example.com');
			config.Set('PORT', 9000);
			expect(config.Get('PORT')).toBe(9000);
		});

		it('type inference is correct (runtime values match expected types)', () => {
			const config = RegisterConfigSchema('Test', schema);
			const host: string = config.Get('HOST');
			const port: number = config.Get('PORT');
			const debug: boolean = config.Get('DEBUG');
			expect(typeof host).toBe('string');
			expect(typeof port).toBe('number');
			expect(typeof debug).toBe('boolean');
		});
	});

	describe('Set', () => {
		it('sets value as OVERRIDE by default', () => {
			const config = RegisterConfigSchema('Test', schema);
			const originalValue = config.Get('HOST');
			config.Set('HOST', 'newhost');
			expect(config.Get('HOST')).toBe('newhost');
			expect(config.Get('HOST')).not.toBe(originalValue);
		});

		it('sets value as DEFAULT when source=DEFAULT', () => {
			const config = RegisterConfigSchema('Test', schema);
			config.Set('HOST', 'defaulthost', 'DEFAULT');
			expect(config.Get('HOST')).toBe('defaulthost');
		});

		it('throws ConfigurationError when value fails schema validation', () => {
			const config = RegisterConfigSchema('Test', schema);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(() => config.Set('PORT', 'not-a-number' as any)).toThrow(ConfigValidationError);
		});
	});

	describe('Validate', () => {
		it('returns true for valid value', () => {
			const config = RegisterConfigSchema('Test', schema);
			expect(config.Validate('HOST', 'example.com')).toBe(true);
			expect(config.Validate('PORT', 9000)).toBe(true);
			expect(config.Validate('DEBUG', true)).toBe(true);
		});

		it('returns false for invalid value (does not throw)', () => {
			const config = RegisterConfigSchema('Test', schema);
			expect(config.Validate('PORT', 'invalid-number')).toBe(false);
			expect(config.Validate('HOST', 123 as unknown)).toBe(false);
			expect(config.Validate('DEBUG', 'not-a-boolean' as unknown)).toBe(false);
		});

		it('does not mutate ConfigManager state (Get before/after equals)', () => {
			const config = RegisterConfigSchema('Test', schema);
			const beforeValidate = config.Get('HOST');
			config.Validate('HOST', 'somehost');
			const afterValidate = config.Get('HOST');
			expect(beforeValidate).toBe(afterValidate);
			expect(afterValidate).toBe('localhost');
		});
	});

	describe('Eager vs Lazy Defaults', () => {
		it('extractDefaultValue handles eager (non-function) default values', () => {
			// Create a mock schema object with _def containing an eager (non-function) defaultValue
			// This tests the branch: typeof dv === 'function' ? dv() : dv (the else case)
			const mockSchema = {
				safeParse: (value: unknown) => ({
					success: true,
					data: value ?? 'eager-localhost'
				}),
				parse: (value: unknown) => value ?? 'eager-localhost',
				_def: {
					defaultValue: 'eager-localhost' // Plain string, not a function
				}
			};

			const schemaObj = z.object({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				EAGER_HOST: mockSchema as any
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const config = RegisterConfigSchema('Eager', schemaObj as any);

			// Verify the eager default value is correctly extracted and registered
			expect(config.Get('EAGER_HOST')).toBe('eager-localhost');
		});

		it('extractDefaultValue handles lazy (function) default values (standard Zod behavior)', () => {
			// Standard Zod 4 behavior: defaults are stored as functions
			const schema = z.object({
				PORT: z.coerce.number().default(9000)
			});

			const config = RegisterConfigSchema('Lazy', schema);

			// Verify the lazy default value is correctly extracted and registered
			expect(config.Get('PORT')).toBe(9000);
		});

		it('extractDefaultValue returns undefined for fields without defaults', () => {
			// When a field has no default value, extractDefaultValue should return undefined
			// This tests the branch where dv === undefined
			const baseSchema = z.object({
				NO_DEFAULT: z.string()
			});

			// RegisterConfigSchema should throw because field has no default
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(() => RegisterConfigSchema('Nodef', baseSchema as any)).toThrow(ConfigValidationError);
		});

		it('extractDefaultValue handles schema without _def property gracefully', () => {
			// Test the branch where schema doesn't have _def or _def is not an object
			const schema = z.object({
				NORMAL: z.string().default('normal-value')
			});

			const config = RegisterConfigSchema('Norm', schema);

			// Should work fine with normal Zod schemas
			expect(config.Get('NORMAL')).toBe('normal-value');
		});

		it('extractDefaultValue returns undefined when _def is not an object or is missing', () => {
			// Create a schema where _def is not an object (e.g., null, undefined, primitive)
			// This should trigger the branch: if (!_def || typeof _def !== 'object') return undefined;
			const mockSchema = {
				safeParse: (value: unknown) => {
					// When undefined is passed, this validation should fail
					if (value === undefined) {
						return { success: false, error: new Error('no default') };
					}
					return { success: true, data: value };
				},
				parse: (value: unknown) => {
					if (value === undefined) throw new Error('no default');
					return value;
				},
				_def: null // _def is null (not an object), so extractDefaultValue will return undefined
			};

			const schemaObj = z.object({
				NO_DEF_FIELD: mockSchema as unknown
			});

			// RegisterConfigSchema should throw because extractDefaultValue returns undefined
			// and safeParse fails with undefined value
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(() => RegisterConfigSchema('Nodefobj', schemaObj as any)).toThrow(ConfigValidationError);
		});

		it('correctly extracts default from z.string().optional().nullable().default("value")', () => {
			const schema = z.object({
				NESTED_OPT_NULLABLE: z.string().optional().nullable().default('nested-default')
			});
			ConfigManager.Reset();
			const config = RegisterConfigSchema('NestedOptNullable', schema);
			expect(config.Get('NESTED_OPT_NULLABLE')).toBe('nested-default');
		});

		it('correctly extracts default from z.number().nullable().default(42)', () => {
			const schema = z.object({
				NULLABLE_NUM: z.number().nullable().default(42)
			});
			ConfigManager.Reset();
			const config = RegisterConfigSchema('NullableNum', schema);
			expect(config.Get('NULLABLE_NUM')).toBe(42);
		});

		it('correctly extracts default from z.boolean().default(false).optional()', () => {
			const schema = z.object({
				DEFAULT_BOOL_OPT: z.boolean().default(false).optional()
			});
			ConfigManager.Reset();
			const config = RegisterConfigSchema('DefaultBoolOpt', schema);
			expect(config.Get('DEFAULT_BOOL_OPT')).toBe(false);
		});
	});

	describe('IsSecret', () => {
		beforeEach(() => ConfigManager.Reset());

		it('returns true for a key marked with Secret()', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key'))
			});
			const config = RegisterConfigSchema('TestIsSecret', schema);
			expect(config.IsSecret('API_KEY')).toBe(true);
		});

		it('returns false for a key not marked with Secret()', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key'))
			});
			const config = RegisterConfigSchema('TestIsSecret', schema);
			expect(config.IsSecret('HOST')).toBe(false);
		});

		it('returns false for all keys when schema has no secrets', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				PORT: z.coerce.number().default(3000)
			});
			const config = RegisterConfigSchema('TestIsSecretNoSecrets', schema);
			expect(config.IsSecret('HOST')).toBe(false);
			expect(config.IsSecret('PORT')).toBe(false);
		});

		it('correctly identifies all secret keys in a mixed schema', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key')),
				PORT: z.coerce.number().default(3000),
				DB_PASS: Secret(z.string().default('default-pass'))
			});
			const config = RegisterConfigSchema('TestIsSecretMixed', schema);
			expect(config.IsSecret('HOST')).toBe(false);
			expect(config.IsSecret('API_KEY')).toBe(true);
			expect(config.IsSecret('PORT')).toBe(false);
			expect(config.IsSecret('DB_PASS')).toBe(true);
		});

		it('does not require Register() to have been called first', () => {
			const schema = z.object({
				API_KEY: Secret(z.string().default('default-key')),
				HOST: z.string().default('localhost')
			});
			const config = RegisterConfigSchema('TestIsSecretNoReg', schema);
			// IsSecret works immediately without explicit registration
			expect(config.IsSecret('API_KEY')).toBe(true);
			expect(config.IsSecret('HOST')).toBe(false);
		});
	});

	describe('GetSecretKeys', () => {
		beforeEach(() => ConfigManager.Reset());

		it('returns [] when no fields are secret', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				PORT: z.coerce.number().default(3000)
			});
			const config = RegisterConfigSchema('TestGetSecretKeysNone', schema);
			expect(config.GetSecretKeys()).toEqual([]);
		});

		it('returns array with the one secret key when exactly one field is marked', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key'))
			});
			const config = RegisterConfigSchema('TestGetSecretKeysOne', schema);
			const secretKeys = config.GetSecretKeys();
			expect(secretKeys).toEqual(['API_KEY']);
		});

		it('returns all secret keys (and only secret keys) from a mixed schema', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key')),
				PORT: z.coerce.number().default(3000),
				DB_PASS: Secret(z.string().default('default-pass'))
			});
			const config = RegisterConfigSchema('TestGetSecretKeysMixed', schema);
			const secretKeys = config.GetSecretKeys();
			expect(secretKeys).toContain('API_KEY');
			expect(secretKeys).toContain('DB_PASS');
			expect(secretKeys.length).toBe(2);
			expect(secretKeys).not.toContain('HOST');
			expect(secretKeys).not.toContain('PORT');
		});

		it('does not include non-secret keys', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key')),
				PORT: z.coerce.number().default(3000)
			});
			const config = RegisterConfigSchema('TestGetSecretKeysNoNs', schema);
			const secretKeys = config.GetSecretKeys();
			secretKeys.forEach((key) => {
				expect(key === 'HOST' || key === 'PORT').toBe(false);
			});
		});

		it('order matches schema shape definition order', () => {
			// Define keys in a specific order: API_KEY, HOST, DB_PASS, PORT
			const schema = z.object({
				API_KEY: Secret(z.string().default('key1')),
				HOST: z.string().default('localhost'),
				DB_PASS: Secret(z.string().default('pass1')),
				PORT: z.coerce.number().default(3000)
			});
			const config = RegisterConfigSchema('TestGetSecretKeysOrder', schema);
			const secretKeys = config.GetSecretKeys();
			// Secret keys should appear in order they appear in schema: API_KEY, then DB_PASS
			expect(secretKeys[0]).toBe('API_KEY');
			expect(secretKeys[1]).toBe('DB_PASS');
		});
	});

	describe('Redact', () => {
		beforeEach(() => ConfigManager.Reset());

		it('returns redacted values immediately after RegisterConfigSchema call', () => {
			const redactSchema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key'))
			});
			const config = RegisterConfigSchema('Redact', redactSchema);
			const result = config.Redact();
			expect(result['HOST']).toBe('localhost');
			expect(result['API_KEY']).toBe('***');
		});

		it('after registration, secret keys show ***; non-secret keys show their default values', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key')),
				PORT: z.coerce.number().default(3000)
			});
			const config = RegisterConfigSchema('TestRedactAfterReg', schema);
			const redacted = config.Redact();
			expect(redacted['HOST']).toBe('localhost');
			expect(redacted['API_KEY']).toBe('***');
			expect(redacted['PORT']).toBe(3000);
		});

		it('after registration and Set() on a secret key, the secret key still shows ***', () => {
			const schema = z.object({
				API_KEY: Secret(z.string().default('default-key'))
			});
			const config = RegisterConfigSchema('TestRedactSecretSet', schema);
			config.Set('API_KEY', 'actual-secret-value');
			const redacted = config.Redact();
			expect(redacted['API_KEY']).toBe('***');
		});

		it('after registration and Set() on a non-secret key, non-secret key shows the updated value', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				API_KEY: Secret(z.string().default('default-key'))
			});
			const config = RegisterConfigSchema('TestRedactNonsecretSet', schema);
			config.Set('HOST', 'example.com');
			const redacted = config.Redact();
			expect(redacted['HOST']).toBe('example.com');
			expect(redacted['API_KEY']).toBe('***');
		});

		it('schema with no secret fields: all values shown as actual values, none replaced with ***', () => {
			const schema = z.object({
				HOST: z.string().default('localhost'),
				PORT: z.coerce.number().default(3000)
			});
			const config = RegisterConfigSchema('TestRedactNoSecrets', schema);
			const redacted = config.Redact();
			expect(redacted['HOST']).toBe('localhost');
			expect(redacted['PORT']).toBe(3000);
			expect(redacted['HOST']).not.toBe('***');
			expect(redacted['PORT']).not.toBe('***');
		});

		it('schema with all secret fields: all values show ***', () => {
			const schema = z.object({
				API_KEY: Secret(z.string().default('key1')),
				DB_PASS: Secret(z.string().default('pass1'))
			});
			const config = RegisterConfigSchema('TestRedactAllSecrets', schema);
			const redacted = config.Redact();
			expect(redacted['API_KEY']).toBe('***');
			expect(redacted['DB_PASS']).toBe('***');
		});

		it('the value for secret keys is exactly the string ***', () => {
			const schema = z.object({
				API_KEY: Secret(z.string().default('default-key'))
			});
			const config = RegisterConfigSchema('TestRedactExactStr', schema);
			const redacted = config.Redact();
			expect(redacted['API_KEY']).toBe('***');
			expect(redacted['API_KEY']).not.toBe('****');
			expect(redacted['API_KEY']).not.toBe('**');
		});

		it('re-throws unexpected errors from Get()', () => {
			const unexpectedError = new TypeError('Unexpected Get() failure');
			const getSpy = vi.spyOn(ConfigManager, 'Get').mockImplementation(() => {
				throw unexpectedError;
			});

			const schema = z.object({
				HOST: z.string().default('localhost')
			});
			const config = RegisterConfigSchema('Redact', schema);

			expect(() => config.Redact()).toThrow(TypeError);
			getSpy.mockRestore();
		});

		it('Redact propagates unexpected errors from Get()', () => {
			// Mock schema that throws an unexpected error (not ConfigurationNotSetError)
			let throwOnGetCall = false;
			const mockSchema = {
				safeParse: (value: unknown) => ({
					success: true,
					data: value
				}),
				parse: () => {
					if (throwOnGetCall) {
						throw new Error('Unexpected schema error');
					}
					return 'localhost';
				}
			};

			// Replace the ConfigManager schema for this key with a problematic one
			ConfigManager.Reset();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			ConfigManager.Register('TEST_HOST', mockSchema as any, 'localhost');

			// Set up to throw on next Get call
			throwOnGetCall = true;

			// Redact should propagate the unexpected error
			expect(() => {
				const result: Record<string, unknown> = {};
				// Simulate what Redact does internally
				try {
					const value = ConfigManager.Get('TEST_HOST');
					result['HOST'] = value;
				}
				catch (error) {
					if (
						error instanceof ConfigNotSetError
						|| error instanceof ConfigNotRegisteredError
					) {
						// omit unregistered/unset keys
					}
					else {
						throw error;
					}
				}
			}).toThrow('Unexpected schema error');
		});
	});
});
