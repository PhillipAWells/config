import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigJSONProvider } from './json-provider.js';
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

		it('required=true (default): throws when file is missing', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: missingPath, required: true });
			await expect(provider.Load()).rejects.toThrow();
		});

		it('required=false: returns empty record when file is missing', async () => {
			const provider = new ConfigJSONProvider({ name: 'json', path: missingPath, required: false });
			const values = await provider.Load();
			expect(values).toEqual({});
		});

		it('required=false: handles non-ENOENT errors gracefully and logs warning', async () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

			// Try to read a directory as a JSON file to trigger a non-ENOENT error
			// (EISDIR on Unix, "Access is denied" on Windows, etc.)
			const testDir = tmpdir();
			const provider = new ConfigJSONProvider({ name: 'json', path: testDir, required: false });
			const values = await provider.Load();

			// When required=false, should return empty and warn for non-ENOENT errors
			expect(values).toEqual({});
			// console.warn should have been called for the error (directory read as JSON)
			expect(warnSpy).toHaveBeenCalled();

			warnSpy.mockRestore();
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
	});

	describe('file size limits', () => {
		it('throws ConfigError when JSON file exceeds 10MB', async () => {
			// Create a large config file in a relative path
			const largeFile = `large-config-test-${Date.now()}.json`;

			// Create a string that exceeds 10MB when serialized
			const largeContent = JSON.stringify({ key: 'x'.repeat(10_500_000) });
			writeFileSync(largeFile, largeContent, 'utf-8');

			const provider = new ConfigJSONProvider({ name: 'json', path: largeFile, required: true });

			try {
				await expect(provider.Load()).rejects.toThrow(ConfigError);
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
	});
});
