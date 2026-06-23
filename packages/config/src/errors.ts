/**
 * Custom error classes for configuration management.
 *
 * Exports: {@link ConfigRegistrationError}, {@link ConfigNotRegisteredError},
 * {@link ConfigError}, and {@link ConfigNotSetError}.
 */

import { BaseError, type TErrorMetadata } from '@pawells/typescript-common';

/**
 * Abstract base class for configuration errors.
 * Automatically sets the error name to the class constructor name.
 */
export class ConfigError extends BaseError {
	constructor(message: string, metadata: TErrorMetadata = {}) {
		metadata.code ??= 'CONFIG_ERROR';
		super(message, metadata);
	}
}

/**
 * Error thrown when attempting to register a configuration key that already exists.
 *
 * @param key - The configuration key that was already registered
 *
 * @example
 * throw new ConfigRegistrationError('DATABASE_URL');
 */
export class ConfigRegistrationError extends ConfigError {
	constructor(key: string, metadata: TErrorMetadata = {}) {
		metadata.code ??= 'CONFIG_REGISTRATION_ERROR';
		super(`Configuration key "${key}" is already registered with a different schema.`, metadata);
	}
}

/**
 * Error thrown when a required configuration value is not set.
 *
 * @param key - The configuration key that is not set
 *
 * @example
 * throw new ConfigNotSetError('DATABASE_URL');
 */
export class ConfigNotSetError extends ConfigError {
	constructor(key: string, metadata: TErrorMetadata = {}) {
		metadata.code ??= 'CONFIG_NOT_SET_ERROR';
		super(`Configuration key "${key}" is not set.`, metadata);
	}
}

/**
 * Error thrown when a configuration key is not registered.
 *
 * @param key - The configuration key that is not registered
 *
 * @example
 * throw new ConfigNotRegisteredError('DATABASE_URL');
 */
export class ConfigNotRegisteredError extends ConfigError {
	constructor(key: string, metadata: TErrorMetadata = {}) {
		metadata.code ??= 'CONFIG_NOT_REGISTERED';
		super(`Configuration key "${key}" is not registered.`, metadata);
	}
}

/**
 * Error thrown when a configuration value fails schema validation.
 *
 * @param key - The configuration key that failed validation
 * @param validationMessage - The validation error message describing why the value is invalid
 *
 * @example
 * throw new ConfigValidationError('PORT', 'Expected a number between 1 and 65535');
 */
export class ConfigValidationError extends ConfigError {
	constructor(key: string, validationMessage: string, metadata: TErrorMetadata = {}) {
		metadata.code ??= 'CONFIG_VALIDATION_ERROR';
		super(`Validation Failed for Configuration "${key}": ${validationMessage}`, metadata);
	}
}
