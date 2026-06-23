import { promises as fs, constants as fsConstants } from 'node:fs';
import { normalize, dirname, basename, join } from 'node:path';
import { ConfigError } from '@pawells/config';

/**
 * Intelligently parses an environment variable string to its native JavaScript type.
 *
 * Attempts `JSON.parse()` to convert encoded booleans (`'true'`), numbers (`'42'`),
 * arrays (`'["a","b"]'`), and `null` to their native JavaScript equivalents.
 * Falls back to returning the original string unchanged if JSON parsing fails.
 * Uses a fast-path optimization to skip `JSON.parse()` for plain strings.
 *
 * @param envVarValue - Raw string value read from `process.env`
 * @returns Parsed value; a native JS type if JSON-parseable, otherwise the original string
 *
 * @remarks
 * The string `"null"` is parsed by `JSON.parse()` and returns the JavaScript `null` value
 * (not the string `"null"`). Schemas that expect a string will reject this value via `safeParse()`.
 *
 * @example
 * ```typescript
 * ParseEnvVarValue('true')        // → true (boolean)
 * ParseEnvVarValue('42')          // → 42 (number)
 * ParseEnvVarValue('["a","b"]')   // → ['a', 'b'] (string[])
 * ParseEnvVarValue('hello world') // → 'hello world' (string, unchanged)
 * ```
 */
export function ParseEnvVarValue(envVarValue: string): unknown {
	// Fast path: skip JSON.parse for plain strings that cannot be valid JSON
	const firstChar = envVarValue[0];
	if (
		firstChar !== '{'
		&& firstChar !== '['
		&& firstChar !== '"'
		&& envVarValue !== 'true'
		&& envVarValue !== 'false'
		&& envVarValue !== 'null'
		&& !/^-?\d/.test(envVarValue)
	) {
		return envVarValue;
	}

	try {
		return JSON.parse(envVarValue);
	}
	catch {
		return envVarValue;
	}
}

/**
 * Parses a `.env` file from disk into a flat key/value record.
 *
 * Processing rules (applied per line):
 * - Lines beginning with `#` (after trimming whitespace) are treated as comments and skipped
 * - Blank lines are skipped
 * - Lines containing `=` are split on the first `=`; the key is trimmed; the value is trimmed
 *   and surrounding single- or double-quotes are stripped if present
 * - Inline comments (e.g. `KEY=value # comment`) are stripped from unquoted values
 * - Lines without `=` are skipped
 * - Windows-style `\r\n` line endings are normalized automatically
 * - Paths containing `..` traversal sequences are rejected for security
 * - Symbolic links are not permitted for security (both final component and parent directories)
 *
 * @param path - Path to the `.env` file to read
 * @returns A promise resolving to a record mapping each key to its raw string value
 * @throws {ConfigError} When the path contains `..` directory traversal sequences
 * @throws {ConfigError} When the path is a symbolic link (final component or parent directory)
 * @throws {Error} If the file cannot be read (e.g. not found, permission denied)
 *
 * @remarks
 * Parent directories are canonicalized via realpath to detect symlinked ancestor directories.
 * The final path component is checked via O_NOFOLLOW for atomic symlink rejection.
 * Inline comments must be preceded by a space to be recognized (e.g., `KEY=value # comment`).
 * A `#` that is not preceded by a space is treated as part of the value.
 *
 * @example
 * ```typescript
 * // .env contents:
 * // # Database configuration
 * // HOST=localhost
 * // PORT=3000
 * // SECRET="my-token"
 * const values = await ParseDotEnvFileAsync('./.env');
 * // → { HOST: 'localhost', PORT: '3000', SECRET: 'my-token' }
 * ```
 */
export async function ParseDotEnvFileAsync(path: string): Promise<Record<string, string>> {
	if (normalize(path).includes('..')) throw new ConfigError(`Path traversal sequences ("..") are not permitted. Received: "${path}"`);

	try {
		// Canonicalize parent directory to detect symlinked ancestors
		const realParent = await fs.realpath(dirname(path));
		const safePath = join(realParent, basename(path));

		// Open file with O_NOFOLLOW to reject symlink final component atomically
		const filehandle = await fs.open(safePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
		let raw: string;
		try {
			const buffer = await filehandle.readFile();
			raw = buffer.toString('utf-8');
		}
		finally {
			await filehandle.close();
		}

		const result: Record<string, string> = {};

		for (const rawLine of raw.split('\n')) {
			const line = rawLine.replace(/\r$/, '').trim();

			if (line === '' || line.startsWith('#')) continue;

			const eqIdx = line.indexOf('=');
			if (eqIdx === -1) continue;

			const key = line.slice(0, eqIdx).trim();
			let value = line.slice(eqIdx + 1).trim();

			if (
				(value.startsWith('"') && value.endsWith('"'))
				|| (value.startsWith('\'') && value.endsWith('\''))
			) {
				value = value.slice(1, -1);
			}
			else {
				// Strip inline # comments (only if value is not quoted)
				const commentIdx = value.indexOf(' #');
				if (commentIdx !== -1) {
					value = value.slice(0, commentIdx).trim();
				}
			}

			if (key !== '') {
				result[key] = value;
			}
		}

		return result;
	}
	catch (error: unknown) {
		// If it's already a ConfigError, rethrow it
		if (error instanceof ConfigError) {
			throw error;
		}

		// Check error codes from fs.open and realpath
		const errorCode = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;

		// ELOOP (Linux) or ENOTDIR (macOS) indicate symlink in final component
		if (errorCode === 'ELOOP' || errorCode === 'ENOTDIR') {
			throw new ConfigError('Symlink paths are not permitted.');
		}

		// Check if it's ENOENT (file not found) — allow optional dotenv files to return empty
		const isNotFound = errorCode === 'ENOENT';

		// If file is missing, return empty config (dotenv files are optional by nature)
		if (isNotFound) {
			return {};
		}

		// All other errors (permission, etc.) are rethrown
		throw error;
	}
}

/**
 * Serializes a configuration value to its `.env` string representation.
 *
 * Conversion rules:
 * - `null` or `undefined` → `''` (blank)
 * - Arrays → JSON-stringified (e.g. `["a","b"]`)
 * - Plain objects → JSON-stringified
 * - `Date` → ISO 8601 string
 * - All other values → `String(value)`
 *
 * @param value - The configuration value to serialize
 * @returns The serialized string ready for inclusion in a `.env` file
 *
 * @example
 * ```typescript
 * SerializeConfigValue('hello')          // → 'hello'
 * SerializeConfigValue(42)               // → '42'
 * SerializeConfigValue(true)             // → 'true'
 * SerializeConfigValue(['a', 'b'])       // → '["a","b"]'
 * SerializeConfigValue({ key: 'value' }) // → '{"key":"value"}'
 * SerializeConfigValue(new Date('2024-01-01T00:00:00.000Z'))
 * // → '2024-01-01T00:00:00.000Z'
 * SerializeConfigValue(null)             // → ''
 * SerializeConfigValue(undefined)        // → ''
 * ```
 */
export function SerializeConfigValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return JSON.stringify(value);
	if (value !== null && typeof value === 'object') return JSON.stringify(value);
	return String(value);
}
