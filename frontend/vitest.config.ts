import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					// SvelteKit, media workers, codecs, and GPU suites share one Vite module
					// runner and Chromium process. Serial files so teardown cannot invalidate
					// the runner while a worker-backed media request is still settling.
					maxWorkers: 1,
					browser: {
						enabled: true,
						provider: playwright({
							launchOptions: {
								...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
								args: ['--enable-unsafe-webgpu']
							}
						}),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
