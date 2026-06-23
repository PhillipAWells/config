import { writeFileSync, unlinkSync, existsSync, symlinkSync, readdirSync, rmdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	ParseEnvVarValue,
	ParseDotEnvFileAsync,
	SerializeConfigValue
} from './env-utils.js';
import type { ConfigError as ConfigErrorType } from '@pawells/config';
import { ConfigError } from '@pawells/config';

describe('ParseEnvVarValue', () => {
	describe('JSON parsing branches', () => {
		it('parses JSON object string: \'{"key":"value"}\'', () => {
			const result = ParseEnvVarValue('{"key":"value"}');
			expect(result).toEqual({ key: 'value' });
		});

		it('parses JSON array string: \'["a","b","c"]\'', () => {
			const result = ParseEnvVarValue('["a","b","c"]');
			expect(result).toEqual(['a', 'b', 'c']);
		});

		it('parses quoted string: \'"hello"\'', () => {
			const result = ParseEnvVarValue('"hello"');
			expect(result).toBe('hello');
		});

		it('parses boolean true: \'true\'', () => {
			const result = ParseEnvVarValue('true');
			expect(result).toBe(true);
		});

		it('parses boolean false: \'false\'', () => {
			const result = ParseEnvVarValue('false');
			expect(result).toBe(false);
		});

		it('parses null: \'null\'', () => {
			const result = ParseEnvVarValue('null');
			expect(result).toBeNull();
		});

		it('parses integer: \'42\'', () => {
			const result = ParseEnvVarValue('42');
			expect(result).toBe(42);
		});

		it('parses negative integer: \'-42\'', () => {
			const result = ParseEnvVarValue('-42');
			expect(result).toBe(-42);
		});

		it('parses decimal number: \'3.14\'', () => {
			const result = ParseEnvVarValue('3.14');
			expect(result).toBe(3.14);
		});

		it('parses negative decimal: \'-3.14\'', () => {
			const result = ParseEnvVarValue('-3.14');
			expect(result).toBe(-3.14);
		});
	});

	describe('Fast-path fallback to string', () => {
		it('returns plain string unchanged: \'hello world\'', () => {
			const result = ParseEnvVarValue('hello world');
			expect(result).toBe('hello world');
			expect(typeof result).toBe('string');
		});

		it('returns string with special chars: \'hello@world!\'', () => {
			const result = ParseEnvVarValue('hello@world!');
			expect(result).toBe('hello@world!');
		});

		it('returns URL-like string unchanged', () => {
			const result = ParseEnvVarValue('https://example.com/path');
			expect(result).toBe('https://example.com/path');
		});
	});

	describe('Invalid JSON fallback', () => {
		it('returns malformed JSON as string: \'{invalid}\'', () => {
			const result = ParseEnvVarValue('{invalid}');
			expect(result).toBe('{invalid}');
			expect(typeof result).toBe('string');
		});

		it('returns incomplete array as string: \'[1,2,\'', () => {
			const result = ParseEnvVarValue('[1,2,');
			expect(result).toBe('[1,2,');
		});
	});
});

describe('SerializeConfigValue', () => {
	it('serializes null to empty string', () => {
		const result = SerializeConfigValue(null);
		expect(result).toBe('');
	});

	it('serializes undefined to empty string', () => {
		const result = SerializeConfigValue(undefined);
		expect(result).toBe('');
	});

	it('serializes boolean true to \'true\'', () => {
		const result = SerializeConfigValue(true);
		expect(result).toBe('true');
	});

	it('serializes boolean false to \'false\'', () => {
		const result = SerializeConfigValue(false);
		expect(result).toBe('false');
	});

	it('serializes number to string: 42 → \'42\'', () => {
		const result = SerializeConfigValue(42);
		expect(result).toBe('42');
	});

	it('serializes negative number: -3.14 → \'-3.14\'', () => {
		const result = SerializeConfigValue(-3.14);
		expect(result).toBe('-3.14');
	});

	it('serializes Date as bare ISO string', () => {
		const date = new Date('2024-01-01T00:00:00.000Z');
		const result = SerializeConfigValue(date);
		expect(result).toBe('2024-01-01T00:00:00.000Z');
	});

	it('serializes array to JSON: [\'a\', \'b\'] → \'["a","b"]\'', () => {
		const result = SerializeConfigValue(['a', 'b']);
		expect(result).toBe('["a","b"]');
	});

	it('serializes plain object to JSON: {key: \'value\'} → \'{"key":"value"}\'', () => {
		const result = SerializeConfigValue({ key: 'value' });
		expect(result).toBe('{"key":"value"}');
	});

	it('serializes string unchanged: \'hello\' → \'hello\'', () => {
		const result = SerializeConfigValue('hello');
		expect(result).toBe('hello');
	});
});

describe('ParseDotEnvFileAsync', () => {
	let tmpFile: string;
	const tmpDir = tmpdir();

	beforeEach(() => {
		tmpFile = join(tmpDir, `env-utils-test-${Date.now()}-${Math.random()}.env`);
	});

	afterEach(() => {
		if (existsSync(tmpFile)) unlinkSync(tmpFile);
	});

	describe('Happy path', () => {
		it('reads and parses a real .env file', async () => {
			writeFileSync(tmpFile, 'KEY=value\nPORT=3000', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.KEY).toBe('value');
			expect(result.PORT).toBe('3000');
		});

		it('parses multiple key-value pairs', async () => {
			writeFileSync(
				tmpFile,
				'HOST=localhost\nPORT=3000\nDEBUG=true',
				'utf-8'
			);
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result).toEqual({
				HOST: 'localhost',
				PORT: '3000',
				DEBUG: 'true'
			});
		});
	});

	describe('Quote handling', () => {
		it('strips double quotes from value', async () => {
			writeFileSync(tmpFile, 'VALUE="hello world"', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.VALUE).toBe('hello world');
		});

		it('strips single quotes from value', async () => {
			writeFileSync(tmpFile, "VALUE='hello world'", 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.VALUE).toBe('hello world');
		});

		it('does not strip mismatched quotes', async () => {
			writeFileSync(tmpFile, 'MIXED="value\'', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.MIXED).toBe('"value\'');
		});

		it('preserves empty quoted strings', async () => {
			writeFileSync(tmpFile, 'EMPTY=""', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.EMPTY).toBe('');
		});
	});

	describe('Inline comment handling', () => {
		it('strips inline comment after space: \'HOST=localhost # comment\'', async () => {
			writeFileSync(tmpFile, 'HOST=localhost # comment', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.HOST).toBe('localhost');
		});

		it('does not strip # without space: \'COLOR=#FF0000\'', async () => {
			writeFileSync(tmpFile, 'COLOR=#FF0000', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.COLOR).toBe('#FF0000');
		});

		it('does not strip # inside quoted value', async () => {
			writeFileSync(tmpFile, 'SECRET="my#secret"', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.SECRET).toBe('my#secret');
		});
	});

	describe('Windows line ending handling', () => {
		it('handles \\r\\n line endings', async () => {
			writeFileSync(tmpFile, 'KEY1=value1\r\nKEY2=value2', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.KEY1).toBe('value1');
			expect(result.KEY2).toBe('value2');
		});

		it('handles mixed \\n and \\r\\n', async () => {
			writeFileSync(tmpFile, 'KEY1=value1\nKEY2=value2\r\nKEY3=value3', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.KEY1).toBe('value1');
			expect(result.KEY2).toBe('value2');
			expect(result.KEY3).toBe('value3');
		});
	});

	describe('Empty/whitespace line handling', () => {
		it('skips empty lines', async () => {
			writeFileSync(tmpFile, 'KEY1=value1\n\nKEY2=value2', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.KEY1).toBe('value1');
			expect(result.KEY2).toBe('value2');
			expect(Object.keys(result).length).toBe(2);
		});

		it('skips whitespace-only lines', async () => {
			writeFileSync(tmpFile, 'KEY1=value1\n   \nKEY2=value2', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.KEY1).toBe('value1');
			expect(result.KEY2).toBe('value2');
		});
	});

	describe('Comment line handling', () => {
		it('skips lines starting with #', async () => {
			writeFileSync(tmpFile, '# This is a comment\nKEY=value', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result['# This is a comment']).toBeUndefined();
			expect(result.KEY).toBe('value');
		});

		it('skips # after whitespace trim', async () => {
			writeFileSync(tmpFile, '  # indented comment\nKEY=value', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(Object.keys(result)).toEqual(['KEY']);
		});
	});

	describe('Path traversal protection', () => {
		it('rejects paths with ".." traversal', async () => {
			const err = await (async () => {
				try {
					await ParseDotEnvFileAsync('../../../etc/passwd');
					return undefined;
				}
				catch (e) {
					return e;
				}
			})();
			expect(err).toBeInstanceOf(ConfigError);
			expect((err as ConfigErrorType).message).toContain('Path traversal');
		});

		it('rejects nested ".." in path', async () => {
			const err = await (async () => {
				try {
					await ParseDotEnvFileAsync('./configs/../../../etc/passwd');
					return undefined;
				}
				catch (e) {
					return e;
				}
			})();
			expect(err).toBeInstanceOf(ConfigError);
		});

		it('allows safe relative paths without ".."', async () => {
			// Safe path that won't exist should throw file-not-found, not ConfigError
			const err = await (async () => {
				try {
					await ParseDotEnvFileAsync('./nonexistent/safe.env');
					return undefined;
				}
				catch (e) {
					return e;
				}
			})();
			if (err) {
				expect(err).not.toBeInstanceOf(ConfigError);
			}
		});
	});

	describe('Symlink protection', () => {
		it('rejects symlink paths', async () => {
			// Create a real temp file and a symlink to it
			const realFile = join(tmpDir, `real-${Date.now()}.env`);
			const symlinkFile = join(tmpDir, `symlink-${Date.now()}.env`);
			try {
				writeFileSync(realFile, 'KEY=value', 'utf-8');
				symlinkSync(realFile, symlinkFile);

				const err = await (async () => {
					try {
						await ParseDotEnvFileAsync(symlinkFile);
						return undefined;
					}
					catch (e) {
						return e;
					}
				})();
				expect(err).toBeInstanceOf(ConfigError);
				expect((err as ConfigErrorType).message).toContain('Symlink');
			}
			finally {
				if (existsSync(realFile)) unlinkSync(realFile);
				if (existsSync(symlinkFile)) unlinkSync(symlinkFile);
			}
		});

		it('resolves files through a symlinked parent directory (realpath canonicalization)', async () => {
			// Create a real directory with a .env file, then symlink to it
			const timestamp = Date.now();
			const realDir = join(tmpDir, `real-dir-${timestamp}`);
			const symlinkDir = join(tmpDir, `symlink-dir-${timestamp}`);
			const envFilePath = join(symlinkDir, `test-${timestamp}.env`);

			try {
				// Create real directory and .env file
				mkdirSync(realDir, { recursive: true });
				const realEnvFile = join(realDir, `test-${timestamp}.env`);
				writeFileSync(realEnvFile, 'KEY=value', 'utf-8');

				// Create symlink to the real directory
				symlinkSync(realDir, symlinkDir, 'dir');

				// Access the file through the symlinked parent directory
				const result = await ParseDotEnvFileAsync(envFilePath);

				// Should resolve successfully and return parsed contents
				expect(result).toEqual({ KEY: 'value' });
			}
			finally {
				// Cleanup: unlink symlink first, then remove real file, then real directory
				try {
					if (existsSync(symlinkDir)) unlinkSync(symlinkDir);
				}
				catch {
					// ignore
				}
				try {
					const realEnvFile = join(realDir, `test-${timestamp}.env`);
					if (existsSync(realEnvFile)) unlinkSync(realEnvFile);
				}
				catch {
					// ignore
				}
				try {
					if (existsSync(realDir)) {
						const files = readdirSync(realDir);
						if (files.length === 0) {
							rmdirSync(realDir);
						}
					}
				}
				catch {
					// ignore
				}
			}
		});
	});

	describe('Edge cases', () => {
		it('splits on first = only: \'KEY=value=extra\'', async () => {
			writeFileSync(tmpFile, 'KEY=value=extra', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.KEY).toBe('value=extra');
		});

		it('skips lines without =', async () => {
			writeFileSync(tmpFile, 'INVALID_NO_EQUALS\nKEY=value', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result['INVALID_NO_EQUALS']).toBeUndefined();
			expect(result.KEY).toBe('value');
		});

		it('skips lines with empty key', async () => {
			writeFileSync(tmpFile, '=value\nKEY=value2', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(Object.keys(result)).toEqual(['KEY']);
		});

		it('trims key and value whitespace', async () => {
			writeFileSync(tmpFile, '  KEY  =  value  ', 'utf-8');
			const result = await ParseDotEnvFileAsync(tmpFile);
			expect(result.KEY).toBe('value');
		});
	});
});
