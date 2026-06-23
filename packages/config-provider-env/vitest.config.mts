import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
	root: __dirname,
	cacheDir: '../../node_modules/.vite/packages/config-provider-env',
	test: {
		name: '@pawells/config-provider-env',
		watch: false,
		globals: true,
		environment: 'node',
		include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
		reporters: ['default'],
		coverage: {
			enabled: false,
			reportsDirectory: './test-output/vitest/coverage',
			provider: 'v8' as const,
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
			thresholds: {
				lines: 80,
				statements: 80,
				branches: 80,
				functions: 80
			}
		}
	}
}));
