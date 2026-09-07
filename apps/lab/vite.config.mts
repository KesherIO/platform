/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(() => {
  const sentryEnabled =
    !!process.env.SENTRY_AUTH_TOKEN &&
    !!process.env.SENTRY_ORG &&
    !!process.env.SENTRY_PROJECT;

  return {
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/apps/lab',
    server: {
      port: 4201,
      host: 'localhost',
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4201,
      host: 'localhost',
    },
    plugins: [
      react(),
      ...(sentryEnabled
        ? [
            sentryVitePlugin({
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              authToken: process.env.SENTRY_AUTH_TOKEN,
              release: {
                name: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
              },
              sourcemaps: {
                filesToDeleteAfterUpload: ['./dist/**/*.map'],
              },
            }),
          ]
        : []),
    ],
    build: {
      outDir: './dist',
      emptyOutDir: true,
      reportCompressedSize: true,
      sourcemap: true,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
    test: {
      name: '@vet-ai/lab',
      watch: false,
      globals: true,
      environment: 'jsdom',
      include: [
        '{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      ],
      reporters: ['default'],
      coverage: {
        reportsDirectory: './test-output/vitest/coverage',
        provider: 'v8' as const,
      },
    },
  };
});
