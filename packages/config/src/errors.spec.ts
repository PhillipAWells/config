import { describe, it, expect } from 'vitest';
import {
	ConfigRegistrationError,
	ConfigNotRegisteredError,
	ConfigValidationError,
	ConfigNotSetError
} from './errors.js';

describe('ConfigRegistrationError', () => {
	it('should construct with key string', () => {
		const error = new ConfigRegistrationError('DATABASE_URL');
		expect(error).toBeInstanceOf(Error);
	});

	it('should have message matching exact template', () => {
		const key = 'DATABASE_URL';
		const error = new ConfigRegistrationError(key);
		expect(error.message).toBe(
			`Configuration key "${key}" is already registered with a different schema.`
		);
	});

	it('should have Code property equal to CONFIGURATION_ALREADY_REGISTERED', () => {
		const error = new ConfigRegistrationError('API_KEY');
		expect(error.Code).toBe('CONFIG_REGISTRATION_ERROR');
	});

	it('should have name property equal to ConfigurationAlreadyRegisteredError', () => {
		const error = new ConfigRegistrationError('SECRET');
		expect(error.name).toBe('ConfigRegistrationError');
	});

	it('should be instanceof Error', () => {
		const error = new ConfigRegistrationError('TEST_KEY');
		expect(error instanceof Error).toBe(true);
	});
});

describe('ConfigNotRegisteredError', () => {
	it('should construct with key string', () => {
		const error = new ConfigNotRegisteredError('DATABASE_URL');
		expect(error).toBeInstanceOf(Error);
	});

	it('should have message matching exact template', () => {
		const key = 'DATABASE_URL';
		const error = new ConfigNotRegisteredError(key);
		expect(error.message).toBe(`Configuration key "${key}" is not registered.`);
	});

	it('should have Code property equal to CONFIGURATION_NOT_REGISTERED', () => {
		const error = new ConfigNotRegisteredError('UNKNOWN_KEY');
		expect(error.Code).toBe('CONFIG_NOT_REGISTERED');
	});

	it('should have name property equal to ConfigurationNotRegisteredError', () => {
		const error = new ConfigNotRegisteredError('MISSING_KEY');
		expect(error.name).toBe('ConfigNotRegisteredError');
	});

	it('should be instanceof Error', () => {
		const error = new ConfigNotRegisteredError('UNSET_KEY');
		expect(error instanceof Error).toBe(true);
	});
});

describe('ConfigurationError', () => {
	it('should construct with key and message', () => {
		const error = new ConfigValidationError('PORT', 'Must be a positive number');
		expect(error).toBeInstanceOf(Error);
	});

	it('should have message matching exact template', () => {
		const key = 'PORT';
		const validationMessage = 'Must be a positive number';
		const error = new ConfigValidationError(key, validationMessage);
		expect(error.message).toBe(
			`Validation Failed for Configuration "${key}": ${validationMessage}`
		);
	});

	it('should have Code property equal to CONFIGURATION_ERROR', () => {
		const error = new ConfigValidationError('DATABASE_URL', 'Invalid URL format');
		expect(error.Code).toBe('CONFIG_VALIDATION_ERROR');
	});

	it('should have name property equal to ConfigurationError', () => {
		const error = new ConfigValidationError('API_KEY', 'Empty string not allowed');
		expect(error.name).toBe('ConfigValidationError');
	});

	it('should be instanceof Error', () => {
		const error = new ConfigValidationError('TIMEOUT', 'Must be a number');
		expect(error instanceof Error).toBe(true);
	});

	it('should set cause when options.cause is provided', () => {
		const originalError = new Error('Original error');
		const error = new ConfigValidationError('CONFIG_KEY', 'Validation failed', {
			cause: originalError
		});
		expect(error.cause).toBe(originalError);
	});

	it('should not set cause when options.cause is not provided', () => {
		const error = new ConfigValidationError('CONFIG_KEY', 'Validation failed', {});
		expect(error.cause).toBeUndefined();
	});

	it('should not set cause when options is omitted entirely', () => {
		const error = new ConfigValidationError('CONFIG_KEY', 'Validation failed');
		expect(error.cause).toBeUndefined();
	});
});

describe('ConfigNotSetError', () => {
	it('should construct with key string', () => {
		const error = new ConfigNotSetError('DATABASE_URL');
		expect(error).toBeInstanceOf(Error);
	});

	it('should have message matching exact template', () => {
		const key = 'DATABASE_URL';
		const error = new ConfigNotSetError(key);
		expect(error.message).toBe(`Configuration key "${key}" is not set.`);
	});

	it('should have Code property equal to CONFIGURATION_NOT_SET', () => {
		const error = new ConfigNotSetError('API_TOKEN');
		expect(error.Code).toBe('CONFIG_NOT_SET_ERROR');
	});

	it('should have name property equal to ConfigurationNotSetError', () => {
		const error = new ConfigNotSetError('SECRET_KEY');
		expect(error.name).toBe('ConfigNotSetError');
	});

	it('should be instanceof Error', () => {
		const error = new ConfigNotSetError('REQUIRED_VALUE');
		expect(error instanceof Error).toBe(true);
	});
});
