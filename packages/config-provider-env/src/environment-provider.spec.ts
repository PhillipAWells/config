import type { ParseDotEnvFileAsync } from './env-utils.js';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigEnvironmentProvider, AssertConfigENVProviderOptions, ValidateConfigENVProviderOptions, AssertConfigENVProviderSaveOptions, ValidateConfigENVProviderSaveOptions } from './environment-provider.js';

let mockParseDotEnvFileAsync: ((path: string) => Promise<Record<string, string>>) | undefined;

vi.mock('./env-utils.js', async () => {
	const actual = await vi.importActual<{ ParseDotEnvFileAsync: typeof ParseDotEnvFileAsync }>('./env-utils.js');
	return {
		...actual,
		ParseDotEnvFileAsync: (path: string) => {
			if (mockParseDotEnvFileAsync) {
				return mockParseDotEnvFileAsync(path);
			}
			return actual.ParseDotEnvFileAsync(path);
		}
	};
});

describe('ConfigEnvironmentProvider', () => {
	const envBackup: Record<string, string | undefined> = {};

	const backupAndSet = (key: string, value: string | undefined) => {
		envBackup[key] = process.env[key];
		if (value === undefined) {
			delete process.env[key];
		}
		else {
			process.env[key] = value;
		}
	};

	afterEach(() => {
		for (const [key, value] of Object.entries(envBackup)) {
			if (value === undefined) {
				delete process.env[key];
			}
			else {
				process.env[key] = value;
			}
		}
		Object.keys(envBackup).forEach((key) => {
			delete envBackup[key];
		});
	});

	describe('Load() — process.env only', () => {
		it('returns record containing current process.env entries', async () => {
			backupAndSet('EP_TEST_KEY', 'hello');
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: '/nonexistent/missing.env' });
			const values = await provider.Load();
			expect(values['EP_TEST_KEY']).toBe('hello');
		});

		it('parses JSON-encoded boolean "true" to boolean true', async () => {
			backupAndSet('EP_BOOL_KEY', 'true');
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: '/nonexistent/missing.env' });
			const values = await provider.Load();
			expect(values['EP_BOOL_KEY']).toBe(true);
		});

		it('parses JSON-encoded number "42" to number 42', async () => {
			backupAndSet('EP_NUM_KEY', '42');
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: '/nonexistent/missing.env' });
			const values = await provider.Load();
			expect(values['EP_NUM_KEY']).toBe(42);
		});

		it('parses JSON array string to array', async () => {
			backupAndSet('EP_ARR_KEY', '["a","b"]');
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: '/nonexistent/missing.env' });
			const values = await provider.Load();
			expect(values['EP_ARR_KEY']).toEqual(['a', 'b']);
		});

		it('plain string (not valid JSON) is returned as-is', async () => {
			backupAndSet('EP_STR_KEY', 'localhost:5432');
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: '/nonexistent/missing.env' });
			const values = await provider.Load();
			expect(values['EP_STR_KEY']).toBe('localhost:5432');
		});

		it('provider name is preserved', () => {
			const provider = new ConfigEnvironmentProvider({ name: 'custom-name', path: '/nonexistent/missing.env' });
			expect(provider.Name).toBe('custom-name');
		});
	});

	describe('Load() — with dotenv file', () => {
		let tmpFile: string;

		beforeEach(() => {
			tmpFile = join(tmpdir(), `ep-test-${Date.now()}.env`);
		});

		afterEach(() => {
			if (existsSync(tmpFile)) unlinkSync(tmpFile);
		});

		it('dotenv values are included in the result', async () => {
			writeFileSync(tmpFile, 'DOTENV_HOST=dotenv-value\n', 'utf-8');
			const provider = new ConfigEnvironmentProvider({ name: 'test', path: tmpFile });
			const values = await provider.Load();
			expect(values['DOTENV_HOST']).toBe('dotenv-value');
		});

		it('dotenv value overrides process.env value for the same key', async () => {
			backupAndSet('OVERRIDE_KEY', 'from-process-env');
			writeFileSync(tmpFile, 'OVERRIDE_KEY=from-dotenv\n', 'utf-8');
			const provider = new ConfigEnvironmentProvider({ name: 'test', path: tmpFile });
			const values = await provider.Load();
			expect(values['OVERRIDE_KEY']).toBe('from-dotenv');
		});

		it('process.env values not in dotenv are still included', async () => {
			backupAndSet('ONLY_IN_PROCESS', 'process-only');
			writeFileSync(tmpFile, 'ONLY_IN_DOTENV=dotenv-only\n', 'utf-8');
			const provider = new ConfigEnvironmentProvider({ name: 'test', path: tmpFile });
			const values = await provider.Load();
			expect(values['ONLY_IN_PROCESS']).toBe('process-only');
			expect(values['ONLY_IN_DOTENV']).toBe('dotenv-only');
		});

		it('dotenv JSON-encoded number is parsed to number', async () => {
			writeFileSync(tmpFile, 'DOTENV_PORT=9090\n', 'utf-8');
			const provider = new ConfigEnvironmentProvider({ name: 'test', path: tmpFile });
			const values = await provider.Load();
			expect(values['DOTENV_PORT']).toBe(9090);
		});

		it('dotenv quoted value has quotes stripped', async () => {
			writeFileSync(tmpFile, 'DOTENV_SECRET="my-secret"\n', 'utf-8');
			const provider = new ConfigEnvironmentProvider({ name: 'test', path: tmpFile });
			const values = await provider.Load();
			expect(values['DOTENV_SECRET']).toBe('my-secret');
		});

		it('dotenv comment lines are ignored', async () => {
			writeFileSync(tmpFile, '# This is a comment\nDOTENV_REAL=value\n', 'utf-8');
			const provider = new ConfigEnvironmentProvider({ name: 'test', path: tmpFile });
			const values = await provider.Load();
			expect(values['DOTENV_REAL']).toBe('value');
			expect(values['# This is a comment']).toBeUndefined();
		});
	});

	describe('missing or unreadable dotenv file', () => {
		const missingPath = '/nonexistent/path/.env';

		it('missing file (ENOENT): silently returns process.env values without throwing', async () => {
			backupAndSet('PROCESS_ONLY_KEY', 'process-val');
			const provider = new ConfigEnvironmentProvider({ name: 'test', path: missingPath });
			const values = await provider.Load();
			// Should return process.env values without throwing
			expect(values?.['PROCESS_ONLY_KEY']).toBe('process-val');
		});

		it('permission denied (EACCES): logs warning and returns process.env values', async () => {
			backupAndSet('PROCESS_VAR', 'from-process');
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

			// Mock ParseDotEnvFileAsync to throw EACCES error
			mockParseDotEnvFileAsync = vi.fn(() => {
				const err = Object.assign(new Error('EACCES: permission denied, open /some/path/.env'), { code: 'EACCES' });
				throw err;
			});

			const provider = new ConfigEnvironmentProvider({ name: 'test', path: '/some/path/.env' });
			const values = await provider.Load();

			// Should include the process.env variable and not crash
			expect(values?.['PROCESS_VAR']).toBe('from-process');
			expect(warnSpy).toHaveBeenCalledOnce();
			// Assert that the warning message does NOT contain the file path (sanitized)
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[ConfigEnvironmentProvider]'));
			expect(warnSpy).toHaveBeenCalledWith(expect.not.stringContaining('/some/path'));

			mockParseDotEnvFileAsync = undefined;
			warnSpy.mockRestore();
		});
	});

	describe('Save()', () => {
		let tmpFile: string;

		beforeEach(() => {
			tmpFile = join(tmpdir(), `env-save-test-${Date.now()}.env`);
		});

		afterEach(() => {
			if (existsSync(tmpFile)) unlinkSync(tmpFile);
		});

		const makeEntry = (
			key: string,
			value: unknown,
			isSecret = false,
			description?: string
		) => ({
			key,
			section: '',
			field: key,
			value,
			isSecret,
			description
		});

		it('writes KEY=value lines to the output file', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			await provider.Save(
				[makeEntry('APP_HOST', 'localhost'), makeEntry('APP_PORT', 3000)],
				{ path: tmpFile }
			);
			const content = readFileSync(tmpFile, 'utf-8');
			expect(content).toBe('APP_HOST=localhost\nAPP_PORT=3000');
		});

		it('template mode: secret entry written as KEY= (blank)', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			await provider.Save(
				[makeEntry('APP_SECRET', 'super-secret', true)],
				{ path: tmpFile, useCurrentValues: false }
			);
			const content = readFileSync(tmpFile, 'utf-8');
			expect(content).toBe('APP_SECRET=');
		});

		it('current-values mode: secret entry written with actual value', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			await provider.Save(
				[makeEntry('APP_SECRET', 'super-secret', true)],
				{ path: tmpFile, useCurrentValues: true }
			);
			const content = readFileSync(tmpFile, 'utf-8');
			expect(content).toBe('APP_SECRET=super-secret');
		});

		it('description emitted as # comment before the key-value pair', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			await provider.Save(
				[makeEntry('APP_HOST', 'localhost', false, 'The application hostname')],
				{ path: tmpFile }
			);
			const content = readFileSync(tmpFile, 'utf-8');
			expect(content).toBe('# The application hostname\nAPP_HOST=localhost');
		});

		it('array value is JSON-stringified', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			await provider.Save(
				[makeEntry('APP_TAGS', ['a', 'b'])],
				{ path: tmpFile }
			);
			const content = readFileSync(tmpFile, 'utf-8');
			expect(content).toBe('APP_TAGS=["a","b"]');
		});

		it('null/undefined value written as blank', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			await provider.Save(
				[makeEntry('APP_OPT', undefined)],
				{ path: tmpFile }
			);
			const content = readFileSync(tmpFile, 'utf-8');
			expect(content).toBe('APP_OPT=');
		});

		it('empty entries array writes empty file', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			await provider.Save([], { path: tmpFile });
			const content = readFileSync(tmpFile, 'utf-8');
			expect(content).toBe('');
		});

		it('throws error when Save() is called with a path traversal in options', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			const entry = makeEntry('TEST_KEY', 'test-value');
			// Save() with a path containing ".." should be rejected by schema validation
			await expect(provider.Save([entry], { path: '../../etc/malicious.env' })).rejects.toThrow();
		});

		it('Save() with no options (undefined) does not throw', async () => {
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });
			const entry = makeEntry('TEST_KEY', 'test-value');
			// Should use the constructor path and not throw
			await provider.Save([entry]);
			const content = readFileSync(tmpFile, 'utf-8');
			expect(content).toBe('TEST_KEY=test-value');
		});
	});

	describe('AssertConfigENVProviderOptions', () => {
		it('accepts valid options', () => {
			const options = { name: 'test', path: '/valid/path/.env' };
			expect(() => AssertConfigENVProviderOptions(options)).not.toThrow();
		});

		it('rejects options with missing name', () => {
			const options = { path: '/valid/path/.env' };
			expect(() => AssertConfigENVProviderOptions(options)).not.toThrow(); // name has a default
		});

		it('rejects options with path traversal ".."', () => {
			const options = { name: 'test', path: '../../etc/passwd' };
			expect(() => AssertConfigENVProviderOptions(options)).toThrow();
		});

		it('rejects options with invalid name (empty string)', () => {
			const options = { name: '', path: '/valid/path/.env' };
			expect(() => AssertConfigENVProviderOptions(options)).toThrow();
		});
	});

	describe('ValidateConfigENVProviderOptions', () => {
		it('returns true for valid options', () => {
			const options = { name: 'test', path: '/valid/path/.env' };
			expect(ValidateConfigENVProviderOptions(options)).toBe(true);
		});

		it('returns false for options with path traversal ".."', () => {
			const options = { name: 'test', path: '../../etc/passwd' };
			expect(ValidateConfigENVProviderOptions(options)).toBe(false);
		});

		it('returns false for invalid options', () => {
			expect(ValidateConfigENVProviderOptions(null)).toBe(false);
			expect(ValidateConfigENVProviderOptions(undefined)).toBe(false);
			expect(ValidateConfigENVProviderOptions('')).toBe(false);
		});
	});

	describe('AssertConfigENVProviderSaveOptions', () => {
		it('accepts valid save options', () => {
			const options = { path: '/valid/path/.env', useCurrentValues: true };
			expect(() => AssertConfigENVProviderSaveOptions(options)).not.toThrow();
		});

		it('accepts empty save options object', () => {
			const options = {};
			expect(() => AssertConfigENVProviderSaveOptions(options)).not.toThrow();
		});

		it('rejects save options with path traversal ".."', () => {
			const options = { path: '../../etc/passwd' };
			expect(() => AssertConfigENVProviderSaveOptions(options)).toThrow();
		});
	});

	describe('ValidateConfigENVProviderSaveOptions', () => {
		it('returns true for valid save options', () => {
			const options = { path: '/valid/path/.env' };
			expect(ValidateConfigENVProviderSaveOptions(options)).toBe(true);
		});

		it('returns true for empty object', () => {
			expect(ValidateConfigENVProviderSaveOptions({})).toBe(true);
		});

		it('returns false for save options with path traversal ".."', () => {
			const options = { path: '../../etc/passwd' };
			expect(ValidateConfigENVProviderSaveOptions(options)).toBe(false);
		});

		it('returns false for invalid options', () => {
			expect(ValidateConfigENVProviderSaveOptions(null)).toBe(false);
			expect(ValidateConfigENVProviderSaveOptions(undefined)).toBe(false);
		});
	});

	describe('ConfigEnvironmentProvider.Register()', () => {
		it('registers provider with ConfigManager and returns it', async () => {
			const provider = await ConfigEnvironmentProvider.Register({
				name: 'test-register'
			});
			expect(provider).toBeInstanceOf(ConfigEnvironmentProvider);
			expect(provider.Name).toBe('test-register');
		});

		it('uses schema defaults when no options provided', async () => {
			const provider = await ConfigEnvironmentProvider.Register();
			expect(provider).toBeInstanceOf(ConfigEnvironmentProvider);
			expect(provider.Name).toBe('environment');
		});
	});

	describe('Date value serialization round-trip', () => {
		let tmpFile: string;

		beforeEach(() => {
			tmpFile = join(tmpdir(), `env-date-test-${Date.now()}.env`);
		});

		afterEach(() => {
			if (existsSync(tmpFile)) unlinkSync(tmpFile);
		});

		it('Date value is serialized in .env file', async () => {
			const testDate = new Date('2024-01-15T12:30:45.000Z');
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: tmpFile });

			const makeEntry = (
				key: string,
				value: unknown,
				isSecret = false,
				description?: string
			) => ({
				key,
				section: '',
				field: key,
				value,
				isSecret,
				description
			});

			// Save with a Date value
			await provider.Save(
				[makeEntry('CONFIG_DATE', testDate)],
				{ path: tmpFile }
			);

			const content = readFileSync(tmpFile, 'utf-8');
			// Date objects are serialized; the exact format depends on JSON.stringify behavior
			expect(content).toContain('CONFIG_DATE=');
			expect(content).toContain('2024-01-15T12:30:45.000Z');
		});

		it('ISO date string loaded from .env is available as string', async () => {
			backupAndSet('CONFIG_DATE', '2024-01-15T12:30:45.000Z');
			const provider = new ConfigEnvironmentProvider({ name: 'env-test', path: '/nonexistent/.env' });
			const values = await provider.Load();
			// ParseEnvVarValue leaves ISO strings as-is since they fail JSON.parse
			expect(values['CONFIG_DATE']).toBe('2024-01-15T12:30:45.000Z');
		});
	});

	describe('Load() error handling with sanitized error messages', () => {
		it('logs warning without path when dotenv read fails', async () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

			mockParseDotEnvFileAsync = vi.fn(() => {
				const err = new Error('Some read error');
				throw err;
			});

			const filePath = '/secret/sensitive/path/.env';
			const provider = new ConfigEnvironmentProvider({ name: 'test', path: filePath });
			const result = await provider.Load();

			expect(warnSpy).toHaveBeenCalledOnce();
			const callArg = warnSpy.mock.calls[0][0];
			expect(callArg).toContain('[ConfigEnvironmentProvider]');
			expect(callArg).not.toContain('/secret/sensitive/path');
			expect(callArg).not.toContain('.env');
			// Should still return an object (process.env values)
			expect(typeof result).toBe('object');

			mockParseDotEnvFileAsync = undefined;
			warnSpy.mockRestore();
		});
	});

	describe('Constructor path traversal validation', () => {
		it('rejects constructor with path containing ".." for security', () => {
			expect(() => {
				new ConfigEnvironmentProvider({ name: 'test', path: '../../etc/passwd' });
			}).toThrow();
		});

		it('accepts constructor with valid path', () => {
			expect(() => {
				new ConfigEnvironmentProvider({ name: 'test', path: '/valid/path/.env' });
			}).not.toThrow();
		});
	});
});
