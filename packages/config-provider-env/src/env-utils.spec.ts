import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ParseDotEnvFile } from './env-utils.js';
import { ConfigError } from '@pawells/config';

describe('ParseDotEnvFile', () => {
	let tmpFile: string;

	beforeEach(() => {
		tmpFile = join(tmpdir(), `env-utils-test-${Date.now()}.env`);
	});

	afterEach(() => {
		if (existsSync(tmpFile)) unlinkSync(tmpFile);
	});

	describe('Quote handling', () => {
		it('mismatched quotes not stripped: MIXED="value\'', () => {
			writeFileSync(tmpFile, 'MIXED="value\'', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['MIXED']).toBe('"value\'');
		});

		it('empty quoted string: EMPTY=""', () => {
			writeFileSync(tmpFile, 'EMPTY=""', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['EMPTY']).toBe('');
		});

		it('empty single-quoted string: EMPTY=\'\'', () => {
			writeFileSync(tmpFile, 'EMPTY=\'\'', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['EMPTY']).toBe('');
		});

		it('quoted value with spaces preserved: VALUE="hello world"', () => {
			writeFileSync(tmpFile, 'VALUE="hello world"', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['VALUE']).toBe('hello world');
		});
	});

	describe('Inline comment handling', () => {
		it('inline comment stripped: HOST=localhost # comment', () => {
			writeFileSync(tmpFile, 'HOST=localhost # comment', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['HOST']).toBe('localhost');
		});

		it('quoted value with # inside not stripped: SECRET="my#secret"', () => {
			writeFileSync(tmpFile, 'SECRET="my#secret"', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['SECRET']).toBe('my#secret');
		});

		it('hash without space not stripped: COLOR=#FF0000', () => {
			writeFileSync(tmpFile, 'COLOR=#FF0000', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['COLOR']).toBe('#FF0000');
		});

		it('multiple spaces before hash: VALUE=test   # comment', () => {
			writeFileSync(tmpFile, 'VALUE=test   # comment', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['VALUE']).toBe('test');
		});
	});

	describe('Invalid line formats', () => {
		it('line without = is skipped: INVALID_NO_EQUALS', () => {
			writeFileSync(tmpFile, 'INVALID_NO_EQUALS', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['INVALID_NO_EQUALS']).toBeUndefined();
		});

		it('empty key skipped: =value', () => {
			writeFileSync(tmpFile, '=value', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(Object.keys(values).length).toBe(0);
		});

		it('whitespace before = results in empty key: "   =value" -> skipped', () => {
			writeFileSync(tmpFile, '   =value', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(Object.keys(values).length).toBe(0);
		});
	});

	describe('Comment lines', () => {
		it('# comment at start of line is skipped', () => {
			writeFileSync(tmpFile, '# This is a comment\nKEY=value', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['# This is a comment']).toBeUndefined();
			expect(values['KEY']).toBe('value');
		});

		it('whitespace before # is trimmed and then treated as comment', () => {
			writeFileSync(tmpFile, '  # comment with indent', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(Object.keys(values).length).toBe(0);
		});
	});

	describe('Blank lines', () => {
		it('blank line is skipped', () => {
			writeFileSync(tmpFile, 'KEY1=value1\n\nKEY2=value2', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['KEY1']).toBe('value1');
			expect(values['KEY2']).toBe('value2');
			expect(Object.keys(values).length).toBe(2);
		});
	});

	describe('Whitespace handling', () => {
		it('key and value whitespace trimmed: "  KEY  =  value  "', () => {
			writeFileSync(tmpFile, '  KEY  =  value  ', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['KEY']).toBe('value');
		});

		it('value with trailing spaces: "KEY=value   "', () => {
			writeFileSync(tmpFile, 'KEY=value   ', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['KEY']).toBe('value');
		});
	});

	describe('Line endings', () => {
		it('windows-style \\r\\n line ending normalized', () => {
			writeFileSync(tmpFile, 'KEY=value\r\nKEY2=value2', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['KEY']).toBe('value');
			expect(values['KEY2']).toBe('value2');
		});

		it('unix-style \\n line ending works', () => {
			writeFileSync(tmpFile, 'KEY=value\nKEY2=value2', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['KEY']).toBe('value');
			expect(values['KEY2']).toBe('value2');
		});
	});

	describe('Edge cases', () => {
		it('multiple = signs: first = is separator', () => {
			writeFileSync(tmpFile, 'KEY=value=extra', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['KEY']).toBe('value=extra');
		});

		it('quoted string with equals inside: SECRET="key=value"', () => {
			writeFileSync(tmpFile, 'SECRET="key=value"', 'utf-8');
			const values = ParseDotEnvFile(tmpFile);
			expect(values['SECRET']).toBe('key=value');
		});
	});

	describe('Path traversal protection', () => {
		it('throws ConfigError for paths containing ".."', () => {
			expect(() => ParseDotEnvFile('../../../etc/passwd')).toThrow(ConfigError);
		});

		it('does not throw ConfigError for relative safe paths', () => {
			// This should not throw ConfigError on path validation alone (file may not exist)
			try {
				ParseDotEnvFile('./relative.env');
			}
			catch (e) {
				expect(e).not.toBeInstanceOf(ConfigError);
			}
		});
	});
});
