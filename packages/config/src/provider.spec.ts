import { describe, it, expect } from 'vitest';
import type {
	TConfigProviderOptions,
	TConfigProviderSaveOptions,
	IConfigProvider,
	ISyncConfigProvider,
	ConfigSaveEntry
} from './provider.js';
import {
	CONFIG_PROVIDER_OPTIONS_SCHEMA,
	AssertConfigProviderOptions,
	ValidateConfigProviderOptions,
	CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA,
	ConfigProvider
} from './provider.js';

describe('CONFIG_PROVIDER_OPTIONS_SCHEMA', () => {
	describe('Valid options', () => {
		it('should parse options with a valid name', () => {
			const options = { name: 'test-provider' };
			const result = CONFIG_PROVIDER_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.name).toBe('test-provider');
			}
		});

		it('should parse options with a single-character name', () => {
			const options = { name: 'x' };
			const result = CONFIG_PROVIDER_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.name).toBe('x');
			}
		});

		it('should parse options with a long name', () => {
			const options = { name: 'my-production-config-provider-instance' };
			const result = CONFIG_PROVIDER_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.name).toBe('my-production-config-provider-instance');
			}
		});
	});

	describe('Invalid options', () => {
		it('should reject options with missing name field', () => {
			const options = {};
			const result = CONFIG_PROVIDER_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(false);
		});

		it('should reject options with empty string name', () => {
			const options = { name: '' };
			const result = CONFIG_PROVIDER_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(false);
		});

		it('should reject options with non-string name', () => {
			const options = { name: 123 };
			const result = CONFIG_PROVIDER_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(false);
		});

		it('should reject options with null name', () => {
			const options = { name: null };
			const result = CONFIG_PROVIDER_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(false);
		});

		it('should reject options with undefined name', () => {
			const options = { name: undefined };
			const result = CONFIG_PROVIDER_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(false);
		});
	});
});

describe('AssertConfigProviderOptions', () => {
	describe('Valid options', () => {
		it('should not throw for valid options', () => {
			const options = { name: 'valid-provider' };
			expect(() => {
				AssertConfigProviderOptions(options);
			}).not.toThrow();
		});

		it('should narrow type to TConfigProviderOptions on valid input', () => {
			const options: unknown = { name: 'test-provider' };
			AssertConfigProviderOptions(options);
			// If we reach here without throwing, the assertion succeeded
			// and the type is narrowed to TConfigProviderOptions
			const _narrowed: TConfigProviderOptions = options;
			expect(_narrowed.name).toBe('test-provider');
		});
	});

	describe('Invalid options', () => {
		it('should throw ZodError for missing name', () => {
			const options = {};
			expect(() => {
				AssertConfigProviderOptions(options);
			}).toThrow();
		});

		it('should throw ZodError for empty string name', () => {
			const options = { name: '' };
			expect(() => {
				AssertConfigProviderOptions(options);
			}).toThrow();
		});

		it('should throw ZodError for non-string name', () => {
			const options = { name: 42 };
			expect(() => {
				AssertConfigProviderOptions(options);
			}).toThrow();
		});

		it('should throw ZodError for null name', () => {
			const options = { name: null };
			expect(() => {
				AssertConfigProviderOptions(options);
			}).toThrow();
		});
	});
});

describe('ValidateConfigProviderOptions', () => {
	describe('Valid options', () => {
		it('should return true for valid options', () => {
			const options = { name: 'valid-provider' };
			const result = ValidateConfigProviderOptions(options);
			expect(result).toBe(true);
		});

		it('should return true for single-character name', () => {
			const options = { name: 'a' };
			const result = ValidateConfigProviderOptions(options);
			expect(result).toBe(true);
		});
	});

	describe('Invalid options', () => {
		it('should return false for missing name', () => {
			const options = {};
			const result = ValidateConfigProviderOptions(options);
			expect(result).toBe(false);
		});

		it('should return false for empty string name', () => {
			const options = { name: '' };
			const result = ValidateConfigProviderOptions(options);
			expect(result).toBe(false);
		});

		it('should return false for non-string name', () => {
			const options = { name: 123 };
			const result = ValidateConfigProviderOptions(options);
			expect(result).toBe(false);
		});

		it('should return false for null name', () => {
			const options = { name: null };
			const result = ValidateConfigProviderOptions(options);
			expect(result).toBe(false);
		});

		it('should return false for non-object input', () => {
			const result = ValidateConfigProviderOptions('not-an-object');
			expect(result).toBe(false);
		});

		it('should return false for array input', () => {
			const result = ValidateConfigProviderOptions(['name']);
			expect(result).toBe(false);
		});
	});
});

describe('CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA', () => {
	describe('Valid options', () => {
		it('should parse empty object', () => {
			const options = {};
			const result = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(true);
		});

		it('should parse with useCurrentValues true', () => {
			const options = { useCurrentValues: true };
			const result = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.useCurrentValues).toBe(true);
			}
		});

		it('should parse with useCurrentValues false', () => {
			const options = { useCurrentValues: false };
			const result = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.useCurrentValues).toBe(false);
			}
		});

		it('should parse with useCurrentValues undefined', () => {
			const options = { useCurrentValues: undefined };
			const result = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(true);
		});
	});

	describe('Invalid options', () => {
		it('should reject useCurrentValues as non-boolean string', () => {
			const options = { useCurrentValues: 'true' };
			const result = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(false);
		});

		it('should reject useCurrentValues as number', () => {
			const options = { useCurrentValues: 1 };
			const result = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(false);
		});

		it('should reject useCurrentValues as null', () => {
			const options = { useCurrentValues: null };
			const result = CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA.safeParse(options);
			expect(result.success).toBe(false);
		});
	});
});

describe('ConfigProvider abstract class', () => {
	describe('Concrete implementation', () => {
		class TestProvider extends ConfigProvider<TConfigProviderOptions> {
			async Load(): Promise<Record<string, unknown>> {
				return { TEST_KEY: 'test-value' };
			}

			async Save(entries: readonly ConfigSaveEntry[]): Promise<void> {
				// Mock implementation
				void entries;
			}
		}

		it('should instantiate with valid options', () => {
			const provider = new TestProvider({ name: 'test-provider' });
			expect(provider).toBeInstanceOf(ConfigProvider);
		});

		it('should expose Name property from options.name', () => {
			const provider = new TestProvider({ name: 'my-provider' });
			expect(provider.Name).toBe('my-provider');
		});

		it('should have Name as readonly getter', () => {
			const provider = new TestProvider({ name: 'test-provider' });
			expect(() => {
				(provider as unknown as { Name: string }).Name = 'should-fail';
			}).toThrow();
		});

		it('should implement IConfigProvider contract', async () => {
			const provider = new TestProvider({ name: 'test-provider' });
			const _interface: IConfigProvider = provider;
			expect(_interface.Name).toBe('test-provider');
		});

		it('should call Load and return expected data', async () => {
			const provider = new TestProvider({ name: 'test-provider' });
			const result = await provider.Load();
			expect(result).toEqual({ TEST_KEY: 'test-value' });
		});

		it('should call Save with entries', async () => {
			let savedEntries: readonly ConfigSaveEntry[] | null = null;
			class SaveTrackingProvider extends ConfigProvider<TConfigProviderOptions> {
				async Load(): Promise<Record<string, unknown>> {
					return {};
				}

				async Save(entries: readonly ConfigSaveEntry[]): Promise<void> {
					savedEntries = entries;
				}
			}

			const provider = new SaveTrackingProvider({ name: 'test-provider' });
			const entries: ConfigSaveEntry[] = [
				{
					key: 'TEST_KEY',
					section: 'TEST',
					field: 'KEY',
					value: 'test-value',
					isSecret: false,
					description: undefined
				}
			];
			await provider.Save(entries);
			expect(savedEntries).toEqual(entries);
		});

		it('should support generic TLoadOptions', async () => {
			class AdvancedProvider extends ConfigProvider<TConfigProviderOptions, { timeout: number }> {
				async Load(options?: { timeout: number }): Promise<Record<string, unknown>> {
					// Simulate timeout usage
					const _timeout = options?.timeout ?? 5000;
					return { TIMEOUT: _timeout };
				}

				async Save(entries: readonly ConfigSaveEntry[]): Promise<void> {
					void entries;
				}
			}

			const provider = new AdvancedProvider({ name: 'advanced-provider' });
			const result = await provider.Load({ timeout: 3000 });
			expect(result).toEqual({ TIMEOUT: 3000 });
		});

		it('should support generic TSaveOptions', async () => {
			class CustomSaveProvider extends ConfigProvider<
				TConfigProviderOptions,
				unknown,
				TConfigProviderSaveOptions
			> {
				async Load(): Promise<Record<string, unknown>> {
					return {};
				}

				async Save(
					entries: readonly ConfigSaveEntry[],
					options?: TConfigProviderSaveOptions
				): Promise<void> {
					const _useCurrentValues = options?.useCurrentValues ?? false;
					void entries;
					void _useCurrentValues;
				}
			}

			const provider = new CustomSaveProvider({ name: 'custom-save-provider' });
			const entries: ConfigSaveEntry[] = [];
			await provider.Save(entries, { useCurrentValues: true });
			expect(provider.Name).toBe('custom-save-provider');
		});
	});

	describe('Constructor behavior', () => {
		class MinimalProvider extends ConfigProvider<TConfigProviderOptions> {
			async Load(): Promise<Record<string, unknown>> {
				return {};
			}

			async Save(entries: readonly ConfigSaveEntry[]): Promise<void> {
				void entries;
			}
		}

		it('should store options and expose name via Name property', () => {
			const options = { name: 'stored-provider' };
			const provider = new MinimalProvider(options);
			expect(provider.Name).toBe('stored-provider');
		});

		it('should handle multiple instances independently', () => {
			const provider1 = new MinimalProvider({ name: 'provider-1' });
			const provider2 = new MinimalProvider({ name: 'provider-2' });
			expect(provider1.Name).toBe('provider-1');
			expect(provider2.Name).toBe('provider-2');
			expect(provider1.Name).not.toBe(provider2.Name);
		});
	});
});

describe('ISyncConfigProvider interface', () => {
	describe('Minimal implementation', () => {
		class SyncTestProvider implements ISyncConfigProvider {
			readonly Name = 'sync-test-provider';

			LoadSync(): Record<string, unknown> {
				return { SYNC_KEY: 'sync-value' };
			}
		}

		it('should implement ISyncConfigProvider contract', () => {
			const provider = new SyncTestProvider();
			const _interface: ISyncConfigProvider = provider;
			expect(_interface.Name).toBe('sync-test-provider');
		});

		it('should expose Name as readonly property', () => {
			const provider = new SyncTestProvider();
			expect(provider.Name).toBe('sync-test-provider');
			// Verify Name is declared as readonly via type system
			const _readonly: Readonly<string> = provider.Name;
			expect(_readonly).toBe('sync-test-provider');
		});

		it('should call LoadSync and return expected data', () => {
			const provider = new SyncTestProvider();
			const result = provider.LoadSync();
			expect(result).toEqual({ SYNC_KEY: 'sync-value' });
		});
	});

	describe('Multiple implementations', () => {
		class SyncMemoryProvider implements ISyncConfigProvider {
			readonly Name = 'sync-memory';

			LoadSync(): Record<string, unknown> {
				return { MEMORY: 'value' };
			}
		}

		class SyncConstantProvider implements ISyncConfigProvider {
			readonly Name = 'sync-constants';

			LoadSync(): Record<string, unknown> {
				return { APP_ENV: 'test' };
			}
		}

		it('should support multiple ISyncConfigProvider implementations', () => {
			const memory = new SyncMemoryProvider();
			const constants = new SyncConstantProvider();

			expect(memory.Name).toBe('sync-memory');
			expect(constants.Name).toBe('sync-constants');
			expect(memory.LoadSync()).toEqual({ MEMORY: 'value' });
			expect(constants.LoadSync()).toEqual({ APP_ENV: 'test' });
		});
	});

	describe('Compatibility with ConfigProvider async interface', () => {
		it('ConfigProvider and ISyncConfigProvider share Name property shape', () => {
			class AsyncProvider extends ConfigProvider<TConfigProviderOptions> {
				async Load(): Promise<Record<string, unknown>> {
					return {};
				}

				async Save(entries: readonly ConfigSaveEntry[]): Promise<void> {
					void entries;
				}
			}

			class SyncProvider implements ISyncConfigProvider {
				readonly Name = 'sync';

				LoadSync(): Record<string, unknown> {
					return {};
				}
			}

			const async_provider = new AsyncProvider({ name: 'async' });
			const sync_provider = new SyncProvider();

			expect(async_provider.Name).toBe('async');
			expect(sync_provider.Name).toBe('sync');
			expect(typeof async_provider.Name).toBe('string');
			expect(typeof sync_provider.Name).toBe('string');
		});
	});
});
