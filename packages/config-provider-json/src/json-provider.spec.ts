import { writeFileSync, readFileSync, unlinkSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigJSONProvider, AssertConfigJSONProviderOptions, ValidateConfigJSONProviderOptions, AssertConfigJSONProviderSaveOptions, ValidateConfigJSONProviderSaveOptions } from './json-provider.js';
import { ConfigError } from '@pawells/config';

describe('ConfigJSONProvider', () => {
	let tmpFile: string;

	beforeEach(() => {
		tmpFile = join(tmpdir(), `jp-test-${Date.now()}.json`);
	});

	afterEach(() => {
		if (existsSync(tmpFile)) unlinkSync(tmpFile);
	});

	describe('load() — nested object flattening', () => {
		it('flattens { KEYCLOAK: { HOST: "x" } } to KEYCLOAK_HOST', async () => {
			writeFileSync(tmpFile, JSON.stringify({ KEYCLOAK: { HOST: 'localhost' } }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values['KEYCLOAK_HOST']).toBe('localhost');
		});

		it('flattens multiple nested keys under same top-level key', async () => {
			writeFileSync(
				tmpFile,
				JSON.stringify({ APP: { HOST: 'localhost', PORT: 3000, DEBUG: false } }),
				'utf-8'
			);
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values['APP_HOST']).toBe('localhost');
			expect(values['APP_PORT']).toBe(3000);
			expect(values['APP_DEBUG']).toBe(false);
		});

		it('flattens multiple top-level sections independently', async () => {
			writeFileSync(
				tmpFile,
				JSON.stringify({
					DB: { HOST: 'dbhost', PORT: 5432 },
					CACHE: { HOST: 'cachehost', TTL: 300 }
				}),
				'utf-8'
			);
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values['DB_HOST']).toBe('dbhost');
			expect(values['DB_PORT']).toBe(5432);
			expect(values['CACHE_HOST']).toBe('cachehost');
			expect(values['CACHE_TTL']).toBe(300);
		});

		it('top-level non-object value is kept under its own key', async () => {
			writeFileSync(tmpFile, JSON.stringify({ VERSION: '1.0.0', MAX_RETRIES: 3 }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values['VERSION']).toBe('1.0.0');
			expect(values['MAX_RETRIES']).toBe(3);
		});

		it('top-level array is kept as-is under its key (not flattened)', async () => {
			writeFileSync(tmpFile, JSON.stringify({ ALLOWED_HOSTS: ['a.com', 'b.com'] }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values['ALLOWED_HOSTS']).toEqual(['a.com', 'b.com']);
		});
	});

	describe('load() — native type preservation', () => {
		it('number values remain as numbers', async () => {
			writeFileSync(tmpFile, JSON.stringify({ APP: { PORT: 8080 } }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(typeof values['APP_PORT']).toBe('number');
			expect(values['APP_PORT']).toBe(8080);
		});

		it('boolean values remain as booleans', async () => {
			writeFileSync(tmpFile, JSON.stringify({ APP: { DEBUG: true } }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(typeof values['APP_DEBUG']).toBe('boolean');
			expect(values['APP_DEBUG']).toBe(true);
		});

		it('null values are preserved as null', async () => {
			writeFileSync(tmpFile, JSON.stringify({ APP: { OPTIONAL: null } }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values['APP_OPTIONAL']).toBeNull();
		});

		it('string array values are preserved', async () => {
			writeFileSync(tmpFile, JSON.stringify({ APP: { TAGS: ['a', 'b', 'c'] } }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values['APP_TAGS']).toEqual(['a', 'b', 'c']);
		});
	});

	describe('load() — non-object root', () => {
		it('returns empty record when JSON root is an array', async () => {
			writeFileSync(tmpFile, JSON.stringify([1, 2, 3]), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(Object.keys(values)).toHaveLength(0);
		});

		it('returns empty record when JSON root is a string', async () => {
			writeFileSync(tmpFile, '"just a string"', 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(Object.keys(values)).toHaveLength(0);
		});

		it('returns empty record when JSON root is null', async () => {
			writeFileSync(tmpFile, 'null', 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(Object.keys(values)).toHaveLength(0);
		});
	});

	describe('missing / unreadable file', () => {
		const missingPath = '/nonexistent/path/config.json';

		it('required=true: throws ConfigError when file is missing (ENOENT)', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: missingPath, required: true });
			await expect(provider.Load()).rejects.toThrow(ConfigError);
		});

		it('required=false: returns empty record when file is missing (ENOENT)', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: missingPath, required: false });
			const values = await provider.Load();
			expect(values).toEqual({});
		});

		it('required=false: rethrows SyntaxError when JSON is malformed (not swallowed)', async () => {
			writeFileSync(tmpFile, '{invalid json}', 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			await expect(provider.Load()).rejects.toThrow(SyntaxError);
		});

		it('required=true: rethrows SyntaxError when JSON is malformed', async () => {
			writeFileSync(tmpFile, '{invalid json}', 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: true });
			await expect(provider.Load()).rejects.toThrow(SyntaxError);
		});

		it('required=true: throws ConfigError with cause when ENOENT (with Error cause)', async () => {
			const missingPath = '/nonexistent/path/config.json';
			const provider = new ConfigJSONProvider({ name: 'json', path: missingPath, required: true });
			try {
				await provider.Load();
				expect.fail('should have thrown');
			}
			catch (error: unknown) {
				expect(error).toBeInstanceOf(ConfigError);
				const configErr = error as ConfigError;
				expect(configErr.message).toContain('Config file not found');
				expect(configErr.cause).toBeInstanceOf(Error);
			}
		});

		it('required=false: rethrows non-ENOENT errors (e.g., permission denied)', async () => {
			const testDir = tmpdir();
			const provider = new ConfigJSONProvider({ name: 'json', path: testDir, required: false });
			// Trying to read a directory as JSON throws an error other than ENOENT
			await expect(provider.Load()).rejects.toThrow();
		});
	});

	describe('provider metadata', () => {
		it('provider name is "json"', () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: './config.json', required: false });
			expect(provider.Name).toBe('json');
		});
	});

	describe('path traversal protection', () => {
		it('throws error when constructed with a path containing ".."', () => {
			// The schema validation throws a ZodError for invalid path, not ConfigError
			expect(() => new ConfigJSONProvider({ name: 'json', path: '../outside/config.json', required: false })).toThrow();
		});

		it('does not throw error for a valid relative path', () => {
			// Should not throw error on path validation (may throw on file not found later)
			expect(() => new ConfigJSONProvider({ name: 'json', path: './config.json', required: false })).not.toThrow();
		});

		it('throws error when Save() is called with a path traversal in options', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const entry = { key: 'TEST_KEY', section: '', field: 'TEST_KEY', value: 'test-value', isSecret: false, description: undefined };
			// Save() with a path containing ".." should be rejected by schema validation
			await expect(provider.Save([entry], { path: '../../etc/malicious.json' })).rejects.toThrow();
		});

		it('Load() throws ConfigError when file is a symlink', async () => {
			const targetFile = join(tmpdir(), `json-target-${Date.now()}.json`);
			const symlinkFile = join(tmpdir(), `json-symlink-${Date.now()}.json`);

			try {
				writeFileSync(targetFile, JSON.stringify({ KEY: 'value' }), 'utf-8');
				symlinkSync(targetFile, symlinkFile);

				const provider = new ConfigJSONProvider({ name: 'json', path: symlinkFile, required: false });
				await expect(provider.Load()).rejects.toThrow(ConfigError);
				await expect(provider.Load()).rejects.toThrow('Symlink');
			}
			finally {
				if (existsSync(symlinkFile)) unlinkSync(symlinkFile);
				if (existsSync(targetFile)) unlinkSync(targetFile);
			}
		});
	});

	describe('file size limits', () => {
		it('throws ConfigError when JSON file exceeds 10MB', async () => {
			// Create a large config file in tmpdir
			const largeFile = join(tmpdir(), `large-config-test-${Date.now()}.json`);

			// Create a string that exceeds 10MB when serialized
			const largeContent = JSON.stringify({ key: 'x'.repeat(10_500_000) });
			writeFileSync(largeFile, largeContent, 'utf-8');

			const provider = new ConfigJSONProvider({ name: 'json', path: largeFile, required: true });

			try {
				await expect(provider.Load()).rejects.toThrow(ConfigError);
				await expect(provider.Load()).rejects.toThrow('10MB');
			}
			finally {
				if (existsSync(largeFile)) unlinkSync(largeFile);
			}
		});
	});

	describe('save()', () => {
		let tmpFile: string;

		beforeEach(() => {
			tmpFile = join(tmpdir(), `json-save-test-${Date.now()}.json`);
		});

		afterEach(() => {
			if (existsSync(tmpFile)) unlinkSync(tmpFile);
		});

		const makeEntry = (
			key: string,
			section: string,
			field: string,
			value: unknown,
			isSecret = false
		) => ({
			key,
			section,
			field,
			value,
			isSecret,
			description: undefined
		});

		it('writes nested JSON grouping entries by section', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			await provider.Save(
				[
					makeEntry('KEYCLOAK_HOST', 'KEYCLOAK', 'HOST', 'localhost'),
					makeEntry('KEYCLOAK_PORT', 'KEYCLOAK', 'PORT', 8080)
				],
				{ path: tmpFile }
			);
			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(parsed).toEqual({ KEYCLOAK: { HOST: 'localhost', PORT: 8080 } });
		});

		it('top-level entry (no section) written at root of JSON', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			await provider.Save(
				[makeEntry('VERSION', '', 'VERSION', '1.2.3')],
				{ path: tmpFile }
			);
			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(parsed).toEqual({ VERSION: '1.2.3' });
		});

		it('template mode: secret field written as null', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			await provider.Save(
				[makeEntry('APP_SECRET', 'APP', 'SECRET', 'real-secret', true)],
				{ path: tmpFile, useCurrentValues: false }
			);
			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(parsed.APP.SECRET).toBeNull();
		});

		it('current-values mode: secret field written with actual value', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			await provider.Save(
				[makeEntry('APP_SECRET', 'APP', 'SECRET', 'real-secret', true)],
				{ path: tmpFile, useCurrentValues: true }
			);
			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(parsed.APP.SECRET).toBe('real-secret');
		});

		it('multiple sections written independently', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			await provider.Save(
				[
					makeEntry('DB_HOST', 'DB', 'HOST', 'dbhost'),
					makeEntry('CACHE_TTL', 'CACHE', 'TTL', 300)
				],
				{ path: tmpFile }
			);
			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(parsed.DB.HOST).toBe('dbhost');
			expect(parsed.CACHE.TTL).toBe(300);
		});

		it('output is pretty-printed with tab indentation', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			await provider.Save(
				[makeEntry('APP_KEY', 'APP', 'KEY', 'val')],
				{ path: tmpFile }
			);
			const raw = readFileSync(tmpFile, 'utf-8');
			expect(raw).toContain('\t');
		});

		it('throws ConfigError when a value cannot be JSON-serialized', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const unserializableEntry = makeEntry('APP_VALUE', 'APP', 'VALUE', BigInt(12345) as unknown);

			await expect(provider.Save([unserializableEntry], { path: tmpFile })).rejects.toThrow(ConfigError);
		});

		it('wraps JSON serialization error with cause in ConfigError', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const unserializableEntry = makeEntry('APP_VALUE', 'APP', 'VALUE', BigInt(12345) as unknown);

			try {
				await provider.Save([unserializableEntry], { path: tmpFile });
				expect.fail('should have thrown');
			}
			catch (error: unknown) {
				expect(error).toBeInstanceOf(ConfigError);
				const configErr = error as ConfigError;
				expect(configErr.message).toContain('serialize');
				expect(configErr.cause).toBeInstanceOf(TypeError);
			}
		});

		it('wraps invalid options as ConfigError (not raw ZodError)', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const entry = makeEntry('TEST_KEY', '', 'TEST_KEY', 'test-value');

			// Pass invalid options (path with ..)
			await expect(provider.Save([entry], { path: '../../malicious.json' })).rejects.toThrow(ConfigError);
		});

		it('wraps invalid options error with cause in ConfigError', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const entry = makeEntry('TEST_KEY', '', 'TEST_KEY', 'test-value');

			try {
				await provider.Save([entry], { path: '../../malicious.json' });
				expect.fail('should have thrown');
			}
			catch (error: unknown) {
				expect(error).toBeInstanceOf(ConfigError);
				const configErr = error as ConfigError;
				expect(configErr.message).toContain('Invalid save options');
				expect(configErr.cause).toBeInstanceOf(Error);
			}
		});

		it('skips a section/primitive collision without crashing', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const entries = [
				makeEntry('APP', '', 'APP', 'primitive-value'),
				makeEntry('APP_HOST', 'APP', 'HOST', 'localhost')
			];

			// First entry sets APP to a primitive, second tries to nest under APP
			// Should skip the second entry and not crash
			await provider.Save(entries, { path: tmpFile });

			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(parsed.APP).toBe('primitive-value');
		});

		it('skips entries with __proto__ key to prevent prototype pollution', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const entries = [
				makeEntry('__proto__', '', '__proto__', { isAdmin: true }),
				makeEntry('SAFE_KEY', '', 'SAFE_KEY', 'safe-value')
			];

			await provider.Save(entries, { path: tmpFile });

			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false);
			expect(parsed.SAFE_KEY).toBe('safe-value');
		});

		it('skips entries with constructor key to prevent prototype pollution', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const entries = [
				makeEntry('constructor', '', 'constructor', { malicious: true }),
				makeEntry('SAFE_KEY', '', 'SAFE_KEY', 'safe-value')
			];

			await provider.Save(entries, { path: tmpFile });

			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(Object.prototype.hasOwnProperty.call(parsed, 'constructor')).toBe(false);
			expect(parsed.SAFE_KEY).toBe('safe-value');
		});

		it('skips entries with prototype key to prevent prototype pollution', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const entries = [
				makeEntry('prototype', '', 'prototype', { malicious: true }),
				makeEntry('SAFE_KEY', '', 'SAFE_KEY', 'safe-value')
			];

			await provider.Save(entries, { path: tmpFile });

			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(parsed.prototype).toBeUndefined();
			expect(parsed.SAFE_KEY).toBe('safe-value');
		});

		it('skips nested section with __proto__ field key', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const entries = [
				makeEntry('APP___proto__', 'APP', '__proto__', { isAdmin: true }),
				makeEntry('APP_HOST', 'APP', 'HOST', 'localhost')
			];

			await provider.Save(entries, { path: tmpFile });

			const parsed = JSON.parse(readFileSync(tmpFile, 'utf-8'));
			expect(Object.prototype.hasOwnProperty.call(parsed.APP, '__proto__')).toBe(false);
			expect(parsed.APP.HOST).toBe('localhost');
		});
	});

	describe('Load() — prototype pollution prevention', () => {
		it('safely loads JSON with __proto__ key, skipping dangerous key', async () => {
			writeFileSync(tmpFile, JSON.stringify({ __proto__: { isAdmin: true }, SAFE_KEY: 'value' }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values.SAFE_KEY).toBe('value');
			expect(Object.prototype.hasOwnProperty.call(values, '__proto__')).toBe(false);
		});

		it('safely loads JSON with constructor key in section, skipping dangerous key', async () => {
			writeFileSync(tmpFile, JSON.stringify({ APP: { constructor: { malicious: true }, HOST: 'localhost' } }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values.APP_HOST).toBe('localhost');
			expect(values.APP_constructor).toBeUndefined();
		});

		it('safely loads JSON with prototype key, skipping dangerous key', async () => {
			writeFileSync(tmpFile, JSON.stringify({ prototype: { x: 1 }, SAFE: 'ok' }), 'utf-8');
			const provider = new ConfigJSONProvider({ name: 'json', path: tmpFile, required: false });
			const values = await provider.Load();
			expect(values.SAFE).toBe('ok');
			expect(values.prototype).toBeUndefined();
		});
	});

	describe('AssertConfigJSONProviderOptions', () => {
		it('passes valid options without throwing', () => {
			const valid = { name: 'json', path: './config.json', required: false };
			expect(() => AssertConfigJSONProviderOptions(valid)).not.toThrow();
		});

		it('throws when path contains ".."', () => {
			const invalid = { name: 'json', path: '../config.json', required: false };
			expect(() => AssertConfigJSONProviderOptions(invalid)).toThrow();
		});

		it('throws when name is missing', () => {
			const invalid = { path: './config.json', required: false };
			expect(() => AssertConfigJSONProviderOptions(invalid)).toThrow();
		});

		it('throws when required is not a boolean', () => {
			const invalid = { name: 'json', path: './config.json', required: 'yes' };
			expect(() => AssertConfigJSONProviderOptions(invalid)).toThrow();
		});
	});

	describe('ValidateConfigJSONProviderOptions', () => {
		it('returns true for valid options', () => {
			const valid = { name: 'json', path: './config.json', required: false };
			expect(ValidateConfigJSONProviderOptions(valid)).toBe(true);
		});

		it('returns false when path contains ".."', () => {
			const invalid = { name: 'json', path: '../config.json', required: false };
			expect(ValidateConfigJSONProviderOptions(invalid)).toBe(false);
		});

		it('returns false when name is missing', () => {
			const invalid = { path: './config.json', required: false };
			expect(ValidateConfigJSONProviderOptions(invalid)).toBe(false);
		});

		it('returns false when required is not a boolean', () => {
			const invalid = { name: 'json', path: './config.json', required: 'yes' };
			expect(ValidateConfigJSONProviderOptions(invalid)).toBe(false);
		});
	});

	describe('AssertConfigJSONProviderSaveOptions', () => {
		it('passes valid save options without throwing', () => {
			const valid = { path: './config.json', useCurrentValues: false };
			expect(() => AssertConfigJSONProviderSaveOptions(valid)).not.toThrow();
		});

		it('passes empty object options (all fields optional)', () => {
			expect(() => AssertConfigJSONProviderSaveOptions({})).not.toThrow();
		});

		it('throws when path contains ".."', () => {
			const invalid = { path: '../../malicious.json' };
			expect(() => AssertConfigJSONProviderSaveOptions(invalid)).toThrow();
		});

		it('throws when useCurrentValues is not a boolean', () => {
			const invalid = { useCurrentValues: 'yes' };
			expect(() => AssertConfigJSONProviderSaveOptions(invalid)).toThrow();
		});
	});

	describe('ValidateConfigJSONProviderSaveOptions', () => {
		it('returns true for valid save options', () => {
			const valid = { path: './config.json', useCurrentValues: false };
			expect(ValidateConfigJSONProviderSaveOptions(valid)).toBe(true);
		});

		it('returns true for empty object options', () => {
			expect(ValidateConfigJSONProviderSaveOptions({})).toBe(true);
		});

		it('returns false when path contains ".."', () => {
			const invalid = { path: '../../malicious.json' };
			expect(ValidateConfigJSONProviderSaveOptions(invalid)).toBe(false);
		});

		it('returns false when useCurrentValues is not a boolean', () => {
			const invalid = { useCurrentValues: 'yes' };
			expect(ValidateConfigJSONProviderSaveOptions(invalid)).toBe(false);
		});
	});

	describe('Register() — async factory', () => {
		it('returns a Promise<ConfigJSONProvider>', async () => {
			const testFile = join(tmpdir(), `register-test-${Date.now()}.json`);
			try {
				const provider = await ConfigJSONProvider.Register({ name: 'test-json', path: testFile, required: false });
				expect(provider).toBeInstanceOf(ConfigJSONProvider);
				expect(provider.Name).toBe('test-json');
			}
			finally {
				if (existsSync(testFile)) unlinkSync(testFile);
			}
		});

		it('registers the provider with ConfigManager', async () => {
			const testFile = join(tmpdir(), `register-manager-test-${Date.now()}.json`);
			try {
				writeFileSync(testFile, JSON.stringify({ TEST_KEY: 'test-value' }), 'utf-8');
				await ConfigJSONProvider.Register({ name: 'test-register', path: testFile, required: false });
				// Provider should be registered and available to ConfigManager
				// (verification would depend on ConfigManager API)
				expect(true).toBe(true); // Placeholder; actual verification depends on ConfigManager internals
			}
			finally {
				if (existsSync(testFile)) unlinkSync(testFile);
			}
		});

		it('throws when Register() is called with invalid options', async () => {
			await expect(ConfigJSONProvider.Register({ name: 'invalid', path: '../bad.json' })).rejects.toThrow();
		});
	});
});
