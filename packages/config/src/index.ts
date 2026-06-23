// Errors
export { ConfigError, ConfigRegistrationError, ConfigNotSetError, ConfigNotRegisteredError, ConfigValidationError } from './errors.js';

// Manager (static singleton)
export { ConfigManager, ScopedConfigManager } from './manager.js';
export type { TConfigSource, TConfigValueTypes, TConfig } from './manager.js';
export { CONFIG_VALUES_TYPES_SCHEMA, AssertConfigValueType } from './manager.js';

// Provider abstractions and schemas
export { ConfigProvider } from './provider.js';
export type { IConfigProvider, ISyncConfigProvider, SaveOptions, ConfigSaveEntry, IConfigSaveEntry } from './provider.js';
export { CONFIG_PROVIDER_OPTIONS_SCHEMA, CONFIG_PROVIDER_SAVE_OPTIONS_SCHEMA } from './provider.js';
export type { TConfigProviderOptions, TConfigProviderSaveOptions } from './provider.js';
export { AssertConfigProviderOptions, ValidateConfigProviderOptions } from './provider.js';

// Schema factory
export { RegisterConfigSchema } from './schema.factory.js';
export type { IConfigSchemaObject } from './schema.factory.js';

// Secret utility
export { Secret } from './secret.js';
