import { z } from 'zod/v4';

/**
 * Marks a Zod schema as secret using Zod v4's globalRegistry metadata system.
 * This allows configuration to automatically detect sensitive fields that should
 * not be logged or exposed in output.
 *
 * The inferred TypeScript type of the schema is unchanged by this operation.
 * The metadata is stored in Zod's global registry for retrieval by validation logic.
 *
 * @param schema - The Zod schema to mark as secret
 * @returns The same schema type with secret metadata registered
 *
 * @remarks
 * The inferred TypeScript type is unchanged and will not affect type inference
 * for values validated by this schema. RegisterConfigSchema automatically detects
 * this marker via the IsMarkedSecret helper to handle sensitive fields specially.
 *
 * @example
 * ```typescript
 * // Mark a simple string as secret
 * const secretToken = Secret(z.string());
 * ```
 *
 * @example
 * ```typescript
 * // Mark a chained schema with constraints
 * const apiKey = Secret(z.string().min(32)).default('');
 * ```
 */
export function Secret<T extends z.ZodTypeAny>(schema: T): T {
	const existingMeta = z.globalRegistry.get(schema) ?? {};
	if ((existingMeta as { secret?: boolean }).secret === true) {
		return schema; // Already marked as secret, no-op
	}
	return schema.meta({ ...existingMeta, secret: true }) as T;
}

/**
 * Generator function that traverses a Zod schema chain to its base type.
 *
 * Yields each schema in the unwrap chain, starting with the input schema.
 * Handles both .unwrap() method (for schemas that support it) and .def.innerType fallback.
 *
 * @param schema - The Zod schema to traverse
 * @yields Each schema in the chain from outermost to innermost
 * @internal
 */
export function* traverseSchemaToBase(schema: z.ZodTypeAny): Generator<z.ZodTypeAny> {
	let current: z.ZodTypeAny | undefined = schema;

	while (current != null) {
		yield current;

		// Traverse to the next level via unwrap or .def.innerType (present in wrapper schemas)
		const unwrapFn = (current as { unwrap?: () => z.ZodTypeAny }).unwrap;
		if (typeof unwrapFn === 'function') {
			current = unwrapFn.call(current) as z.ZodTypeAny;
		}
		else {
			const innerType = (current as { def?: { innerType?: unknown } }).def?.innerType as
			  | z.ZodTypeAny
			  | undefined;
			current = innerType;
		}
	}
}

/**
 * Internal helper function that traverses the Zod schema metadata chain
 * to determine if a schema is marked as secret.
 *
 * Walks through the unwrap chain of wrapper schemas (e.g., ZodDefault,
 * ZodOptional) and checks each level's metadata in the global registry.
 *
 * @param schema - The Zod schema to check for secret metadata
 * @returns true if the schema or any of its inner schemas has secret=true metadata
 * @internal
 */
function IsMarkedSecret(schema: z.ZodTypeAny): boolean {
	for (const current of traverseSchemaToBase(schema)) {
		try {
			const meta = z.globalRegistry.get(current);
			if (meta?.secret === true) {
				return true;
			}
		}
		catch {
			// Schema does not support registry lookup (e.g. mock/partial schema objects).
			// Treat as non-secret and stop traversal.
			break;
		}
	}

	return false;
}

// Export for testing and advanced use cases (though marked as internal)
export { IsMarkedSecret };
