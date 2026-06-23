import type { ParseDotEnvFile as ParseDotEnvFileType } from './env-utils.js';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigEnvironmentProvider } from './environment-provider.js';

let mockReadFileSync: ((...args: unknown[]) => string) | undefined;

vi.mock('./env-utils.js', async () => {
	const actual = await vi.importActual<{ ParseDotEnvFile: typeof ParseDotEnvFileType }>('./env-utils.js');
	return {
		...actual,
		ParseDotEnvFile: (path: string) => {
			if (mockReadFileSync) {
				return mockReadFileSync(path);
			}
			return actual.ParseDotEnvFile(path);
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

			// Mock ParseDotEnvFile to throw EACCES error
			mockReadFileSync = vi.fn(() => {
				const err = Object.assign(new Error('EACCES: permission denied, open /some/path/.env'), { code: 'EACCES' });
				throw err;
			});

			const provider = new ConfigEnvironmentProvider({ name: 'test', path: '/some/path/.env' });
			const values = await provider.Load();

			// Should include the process.env variable and not crash
			expect(values?.['PROCESS_VAR']).toBe('from-process');
			expect(warnSpy).toHaveBeenCalledOnce();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[ConfigEnvironmentProvider]'));

			mockReadFileSync = undefined;
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
	});
});
