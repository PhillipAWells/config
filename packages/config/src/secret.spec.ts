import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';
import { Secret, IsMarkedSecret } from './secret.js';

describe('Secret', () => {
	describe('Parsing behavior', () => {
		it('Secret(z.string()) correctly parses a valid string', () => {
			const schema = Secret(z.string());
			const result = schema.safeParse('hello');
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe('hello');
			}
		});

		it('Secret(z.number()) correctly parses a valid number', () => {
			const schema = Secret(z.number());
			const result = schema.safeParse(42);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe(42);
			}
		});
	});

	describe('Metadata attachment', () => {
		it('Secret(z.string()) attaches { secret: true } to registry entry', () => {
			const schema = Secret(z.string());
			const meta = z.globalRegistry.get(schema);
			expect(meta).toBeDefined();
			expect(meta?.secret).toBe(true);
		});

		it('Secret(z.string()) returns a new schema object (not same reference as input)', () => {
			const inputSchema = z.string();
			const resultSchema = Secret(inputSchema);
			expect(resultSchema).not.toBe(inputSchema);
		});
	});

	describe('Chain survival', () => {
		it('Secret(z.string().optional()) is detected as secret via IsMarkedSecret', () => {
			const schema = Secret(z.string().optional());
			expect(IsMarkedSecret(schema)).toBe(true);
		});

		it('Secret(z.string()).default("x") is detected as secret via IsMarkedSecret', () => {
			const schema = Secret(z.string()).default('x');
			expect(IsMarkedSecret(schema)).toBe(true);
		});

		it('Secret(z.string()).nullable() is detected as secret via IsMarkedSecret', () => {
			const schema = Secret(z.string()).nullable();
			expect(IsMarkedSecret(schema)).toBe(true);
		});

		it('Secret(z.string()).optional().nullable() is detected as secret through multiple wrapper layers', () => {
			const schema = Secret(z.string()).optional().nullable();
			expect(IsMarkedSecret(schema)).toBe(true);
		});
	});

	describe('Non-secret detection', () => {
		it('z.string() without Secret is not marked as secret', () => {
			const schema = z.string();
			expect(IsMarkedSecret(schema)).toBe(false);
		});

		it('z.string().optional() without Secret is not marked as secret', () => {
			const schema = z.string().optional();
			expect(IsMarkedSecret(schema)).toBe(false);
		});
	});

	describe('Meta-merge safety', () => {
		it('Secret() on a schema with existing .meta({ description: "docs" }) preserves both metadata', () => {
			const baseSchema = z.string().meta({ description: 'docs' });
			const secretSchema = Secret(baseSchema);
			const meta = z.globalRegistry.get(secretSchema);
			expect(meta?.secret).toBe(true);
			expect(meta?.description).toBe('docs');
		});
	});

	describe('Idempotency', () => {
		it('Secret(Secret(z.string())) detects as secret without throwing', () => {
			const schema = Secret(Secret(z.string()));
			expect(IsMarkedSecret(schema)).toBe(true);
			const meta = z.globalRegistry.get(schema);
			expect(meta?.secret).toBe(true);
		});
	});

	describe('Type preservation', () => {
		it('infers type correctly as string from Secret(z.string())', () => {
			const _schema = Secret(z.string());
			type InferredType = z.infer<typeof _schema>;
			const _test: InferredType = 'hello';
			expect(typeof _test).toBe('string');
		});

		it('infers type correctly as number from Secret(z.number())', () => {
			const _schema = Secret(z.number());
			type InferredType = z.infer<typeof _schema>;
			const _test: InferredType = 42;
			expect(typeof _test).toBe('number');
		});

		it('infers type correctly as string | undefined from Secret(z.string().optional())', () => {
			const _schema = Secret(z.string().optional());
			type InferredType = z.infer<typeof _schema>;
			const _testString: InferredType = 'hello';
			const _testUndefined: InferredType = undefined;
			expect(_testString).toBe('hello');
			expect(_testUndefined).toBeUndefined();
		});
	});
});
